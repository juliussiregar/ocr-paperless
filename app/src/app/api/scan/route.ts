import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueScanJob } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { decrypt } from "@/lib/crypto";
import { ScanJobStatus } from "@prisma/client";
import { scanMaxFilesFromEnv } from "@/lib/scan-cleanup";
import { activeScanJobWhere } from "@/lib/scan-status";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const rl = rateLimit(`scan:${userId}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      encryptedBappenasUsername: true,
      encryptedBappenasPassword: true,
    },
  });

  if (!user?.encryptedBappenasUsername || !user.encryptedBappenasPassword) {
    return NextResponse.json(
      {
        error:
          "Kredensial Cloud Bappenas belum diisi. Lengkapi di Profil sebelum scan.",
      },
      { status: 400 }
    );
  }

  try {
    const u = decrypt(user.encryptedBappenasUsername);
    if (!u || u === "admin-placeholder") {
      return NextResponse.json(
        {
          error:
            "Kredensial Cloud Bappenas belum valid. Perbarui di Profil sebelum scan.",
        },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Kredensial Bappenas rusak. Perbarui di Profil." },
      { status: 400 }
    );
  }

  const active = await prisma.scanJob.findFirst({
    where: activeScanJobWhere(userId),
  });

  if (active) {
    return NextResponse.json(
      {
        error: "Scan sudah berjalan untuk akun Anda",
        jobId: active.id,
        status: active.status,
      },
      { status: 409 }
    );
  }

  const job = await prisma.scanJob.create({
    data: {
      triggeredById: userId,
      status: ScanJobStatus.PENDING,
    },
  });

  await enqueueScanJob(job.id);
  await writeAudit("scan.start", userId, { jobId: job.id });

  return NextResponse.json({ jobId: job.id, status: job.status });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const maxFiles = scanMaxFilesFromEnv();
  const queueTake = Math.min(
    200,
    Math.max(
      20,
      Number(request.nextUrl.searchParams.get("queueLimit")) ||
        (maxFiles > 0 ? maxFiles : 50)
    )
  );

  const [latest, active, stats, user, failedFiles, processingFiles, failedTotal, processingTotal] =
    await Promise.all([
      prisma.scanJob.findFirst({
        where: { triggeredById: userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.scanJob.findFirst({
        where: activeScanJobWhere(userId),
        orderBy: { createdAt: "desc" },
      }),
      prisma.syncFile.groupBy({
        by: ["syncStatus"],
        where: { userId },
        _count: true,
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { lastSyncAt: true, lastDiscoveryAt: true },
      }),
      prisma.syncFile.findMany({
        where: { userId, syncStatus: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: queueTake,
        select: {
          id: true,
          fileName: true,
          remotePath: true,
          errorMessage: true,
          updatedAt: true,
          paperlessDocumentId: true,
        },
      }),
      prisma.syncFile.findMany({
        where: {
          userId,
          syncStatus: { in: ["DOWNLOADING", "QUEUED", "OCR_PENDING"] },
        },
        orderBy: { updatedAt: "desc" },
        take: queueTake,
        select: {
          id: true,
          fileName: true,
          remotePath: true,
          syncStatus: true,
          updatedAt: true,
          ocrPendingAt: true,
          paperlessDocumentId: true,
        },
      }),
      prisma.syncFile.count({ where: { userId, syncStatus: "FAILED" } }),
      prisma.syncFile.count({
        where: {
          userId,
          syncStatus: { in: ["DOWNLOADING", "QUEUED", "OCR_PENDING"] },
        },
      }),
    ]);

  return NextResponse.json({
    latestJob: latest,
    activeJob: active,
    syncStats: stats,
    lastSyncAt: user?.lastSyncAt ?? null,
    lastDiscoveryAt: user?.lastDiscoveryAt ?? null,
    limits: {
      maxFiles,
      maxNewest: Math.min(100, maxFiles > 0 ? maxFiles : 100),
      retryBatch: maxFiles > 0 ? maxFiles : 50,
      ocrTimeoutMinutes: Number(process.env.OCR_PENDING_TIMEOUT_MINUTES ?? 180),
    },
    queue: {
      ocrPending:
        stats.find((s) => s.syncStatus === "OCR_PENDING")?._count ?? 0,
      downloading:
        stats.find((s) => s.syncStatus === "DOWNLOADING")?._count ?? 0,
      queued: stats.find((s) => s.syncStatus === "QUEUED")?._count ?? 0,
      failed: stats.find((s) => s.syncStatus === "FAILED")?._count ?? 0,
      ready:
        (stats.find((s) => s.syncStatus === "OCR_DONE")?._count ?? 0) +
        (stats.find((s) => s.syncStatus === "SKIPPED")?._count ?? 0),
    },
    queueFiles: {
      failed: failedFiles.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        remotePath: f.remotePath,
        errorMessage: f.errorMessage,
        updatedAt: f.updatedAt,
        paperlessDocumentId: f.paperlessDocumentId,
      })),
      processing: processingFiles.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        remotePath: f.remotePath,
        syncStatus: f.syncStatus,
        updatedAt: f.updatedAt,
        ocrPendingAt: f.ocrPendingAt,
        paperlessDocumentId: f.paperlessDocumentId,
      })),
      failedHasMore: failedTotal > failedFiles.length,
      processingHasMore: processingTotal > processingFiles.length,
      shown: queueTake,
    },
  });
}
