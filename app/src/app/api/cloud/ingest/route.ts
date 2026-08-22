import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueScanJob } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { scanMaxFilesFromEnv } from "@/lib/scan-cleanup";
import { activeScanJobWhere } from "@/lib/scan-status";

const DEFAULT_NEWEST = 10;

function normalizeRoot(path: unknown): string {
  if (typeof path !== "string" || !path.trim() || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/$/, "") || "/";
}

async function assertNoActiveJob(userId: string) {
  return prisma.scanJob.findFirst({
    where: activeScanJobWhere(userId),
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const rl = rateLimit(`cloud-ingest:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
        { status: 429 }
      );
    }

    const creds = await getUserBappenasCreds(userId);
    if (!creds) {
      return NextResponse.json(
        { error: "Kredensial Cloud Bappenas belum diisi. Lengkapi di Profil." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const mode = (body.mode as string) || "paths";
    const rootPath = normalizeRoot(body.rootPath);
    const maxFiles = scanMaxFilesFromEnv();
    const maxNewest = Math.min(100, maxFiles > 0 ? maxFiles : 100);

    const active = await assertNoActiveJob(userId);
    if (active) {
      return NextResponse.json(
        {
          error: "Masih ada proses ambil dokumen yang berjalan",
          jobId: active.id,
          status: active.status,
        },
        { status: 409 }
      );
    }

    // --- Manual checkbox paths ---
    if (mode === "paths") {
      const rawPaths: unknown[] = Array.isArray(body.paths) ? body.paths : [];
      let paths = [
        ...new Set(
          rawPaths
            .filter((p): p is string => typeof p === "string" && p.length > 0)
            .map((p) => (p.startsWith("/") ? p : `/${p}`))
            .filter((p) => p.toLowerCase().endsWith(".pdf"))
        ),
      ];

      if (paths.length === 0) {
        return NextResponse.json(
          { error: "Pilih minimal satu file PDF" },
          { status: 400 }
        );
      }

      if (maxFiles > 0 && paths.length > maxFiles) {
        return NextResponse.json(
          {
            error: `Maksimal ${maxFiles} file per permintaan (SCAN_MAX_FILES)`,
            maxFiles,
          },
          { status: 400 }
        );
      }

      for (const remotePath of paths) {
        const fileName =
          remotePath.split("/").filter(Boolean).pop() ?? remotePath;
        await prisma.syncFile.upsert({
          where: { userId_remotePath: { userId, remotePath } },
          create: {
            userId,
            remotePath,
            fileName,
            syncStatus: SyncStatus.QUEUED,
            errorMessage: null,
          },
          update: {
            syncStatus: SyncStatus.QUEUED,
            errorMessage: null,
          },
        });
      }

      const job = await prisma.scanJob.create({
        data: {
          triggeredBy: { connect: { id: userId } },
          status: ScanJobStatus.PENDING,
          jobType: "ingest_selected",
          selectedPaths: JSON.stringify({ mode: "paths", paths }),
          totalFiles: paths.length,
        },
      });

      await enqueueScanJob(job.id);
      await writeAudit("cloud.ingest", userId, {
        jobId: job.id,
        mode: "paths",
        count: paths.length,
      });

      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        mode: "paths",
        totalFiles: paths.length,
        maxFiles,
      });
    }

    // --- N newest in scope (whole cloud or folder) ---
    if (mode === "newest") {
      let limit = Math.min(
        maxNewest,
        Math.max(1, Number(body.limit) || DEFAULT_NEWEST)
      );
      if (maxFiles > 0) limit = Math.min(limit, maxFiles);

      const job = await prisma.scanJob.create({
        data: {
          triggeredBy: { connect: { id: userId } },
          status: ScanJobStatus.PENDING,
          jobType: "ingest_newest",
          selectedPaths: JSON.stringify({
            mode: "newest",
            rootPath,
            limit,
          }),
          totalFiles: 0,
        },
      });

      await enqueueScanJob(job.id);
      await writeAudit("cloud.ingest", userId, {
        jobId: job.id,
        mode: "newest",
        rootPath,
        limit,
      });

      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        mode: "newest",
        rootPath,
        limit,
        maxFiles,
        message:
          rootPath === "/"
            ? `Finding ${limit} newest PDF(s) across the entire cloud...`
            : `Finding ${limit} newest PDF(s) in this folder...`,
      });
    }

    // --- Pending PDFs in scope (capped) ---
    if (mode === "all") {
      let limit =
        body.limit == null || body.limit === ""
          ? maxFiles > 0
            ? maxFiles
            : null
          : Math.max(1, Number(body.limit) || maxFiles || 50);
      if (maxFiles > 0 && limit != null) limit = Math.min(limit, maxFiles);
      if (maxFiles > 0 && (limit == null || limit <= 0)) limit = maxFiles;

      const job = await prisma.scanJob.create({
        data: {
          triggeredBy: { connect: { id: userId } },
          status: ScanJobStatus.PENDING,
          jobType: "ingest_all",
          selectedPaths: JSON.stringify({
            mode: "all",
            rootPath,
            limit,
          }),
          totalFiles: 0,
        },
      });

      await enqueueScanJob(job.id);
      await writeAudit("cloud.ingest", userId, {
        jobId: job.id,
        mode: "all",
        rootPath,
        limit,
      });

      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        mode: "all",
        rootPath,
        limit,
        maxFiles,
        message:
          limit != null
            ? `Ingesting up to ${limit} pending PDF(s) in scope...`
            : "Ingesting all pending PDFs in scope...",
      });
    }

    return NextResponse.json({ error: "Mode tidak dikenal" }, { status: 400 });
  } catch (err) {
    console.error("[cloud/ingest]", err);
    const message =
      err instanceof Error ? err.message : "Gagal memulai pengambilan dokumen";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
