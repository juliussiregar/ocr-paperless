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

/** Retry failed sync files (re-queue for ingest). */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const rl = rateLimit(`cloud-retry:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
        { status: 429 }
      );
    }

    const creds = await getUserBappenasCreds(userId);
    if (!creds) {
      return NextResponse.json(
        { error: "Kredensial Cloud Bappenas belum diisi.", code: "NO_CREDS" },
        { status: 400 }
      );
    }

    const maxFiles = scanMaxFilesFromEnv();
    const batchCap = maxFiles > 0 ? maxFiles : 100;

    const body = await request.json().catch(() => ({}));
    const allFailed = body.allFailed === true;
    const rawPaths: unknown[] = Array.isArray(body.paths) ? body.paths : [];

    let paths: string[] = [];

    if (allFailed) {
      const failed = await prisma.syncFile.findMany({
        where: { userId, syncStatus: SyncStatus.FAILED },
        select: { remotePath: true },
        orderBy: { updatedAt: "desc" },
        take: batchCap,
      });
      paths = failed.map((f) => f.remotePath);
    } else {
      paths = [
        ...new Set(
          rawPaths
            .filter((p): p is string => typeof p === "string" && p.length > 0)
            .map((p) => (p.startsWith("/") ? p : `/${p}`))
        ),
      ];
    }

    paths = paths
      .filter((p) => p.toLowerCase().endsWith(".pdf"))
      .slice(0, batchCap);

    if (paths.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada file gagal untuk diulang" },
        { status: 400 }
      );
    }

    const active = await prisma.scanJob.findFirst({
      where: activeScanJobWhere(userId),
    });
    if (active) {
      return NextResponse.json(
        {
          error: "Masih ada proses ambil dokumen yang berjalan",
          jobId: active.id,
        },
        { status: 409 }
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

    try {
      await enqueueScanJob(job.id);
    } catch (err) {
      await prisma.scanJob.update({
        where: { id: job.id },
        data: {
          status: ScanJobStatus.FAILED,
          completedAt: new Date(),
          errorMessage: `Gagal enqueue: ${
            err instanceof Error ? err.message : "unknown"
          }`,
          phase: "done",
        },
      });
      throw err;
    }

    await writeAudit("cloud.retry", userId, {
      jobId: job.id,
      count: paths.length,
    });

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      totalFiles: paths.length,
      maxFiles: batchCap,
    });
  } catch (err) {
    console.error("[cloud/retry]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Gagal mengulang file gagal",
      },
      { status: 500 }
    );
  }
}
