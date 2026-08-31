import { NextRequest, NextResponse } from "next/server";
import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/session";
import { enqueueScanJob } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { activeScanJobWhere } from "@/lib/scan-status";
import { getAutoScanSettings } from "@/lib/app-settings";
import { getScanHealth, releaseUserScanLock } from "@/lib/scan-health";

function ingestMaxRetries(): number {
  const n = Number(process.env.INGEST_MAX_RETRY_COUNT ?? "5");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export async function GET() {
  const { error } = await requireAdminApi();
  if (error) return error;

  const maxRetries = ingestMaxRetries();
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, lastDiscoveryAt: true },
    orderBy: { email: "asc" },
  });

  const backlog = await Promise.all(
    users.map(async (u) => {
      const [ocrDone, ocrPending, failed, failedRetryable, failedExhausted, downloading, activeJob] =
        await Promise.all([
          prisma.syncFile.count({
            where: { userId: u.id, syncStatus: SyncStatus.OCR_DONE },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: {
                in: [SyncStatus.OCR_PENDING, SyncStatus.QUEUED],
              },
            },
          }),
          prisma.syncFile.count({
            where: { userId: u.id, syncStatus: SyncStatus.FAILED },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ingestRetryCount: { lt: maxRetries },
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ingestRetryCount: { gte: maxRetries },
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: {
                in: [SyncStatus.DOWNLOADING, SyncStatus.DISCOVERED],
              },
            },
          }),
          prisma.scanJob.findFirst({
            where: activeScanJobWhere(u.id),
            select: {
              id: true,
              jobType: true,
              phase: true,
              status: true,
              startedAt: true,
              currentFile: true,
            },
          }),
        ]);
      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        lastDiscoveryAt: u.lastDiscoveryAt,
        ocrDone,
        ocrPending,
        failed,
        failedRetryable,
        failedExhausted,
        downloading,
        activeJob,
        scanLockHeld: false,
      };
    })
  );

  const health = await getScanHealth();
  for (const row of backlog) {
    row.scanLockHeld = health.userLocks.includes(row.userId);
  }

  const settings = await getAutoScanSettings();

  const queueCounts = await prisma.scanJob.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: {
      status: {
        in: [
          ScanJobStatus.PENDING,
          ScanJobStatus.RUNNING,
          ScanJobStatus.PAUSED,
        ],
      },
    },
  });

  return NextResponse.json({
    backlog,
    settings,
    health,
    activeJobs: queueCounts.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
  });
}

/** Manual delta_sync trigger or debug actions. */
export async function POST(request: NextRequest) {
  const { session, error } = await requireAdminApi();
  if (error) return error;

  const body = await request.json().catch(() => ({}));

  if (body.action === "releaseLock") {
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) {
      return NextResponse.json({ error: "userId wajib" }, { status: 400 });
    }
    const released = await releaseUserScanLock(userId);
    await writeAudit("admin.scan.release_lock", session!.user.id, {
      targetUserId: userId,
      released,
    });
    return NextResponse.json({ ok: true, released });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const rootPath =
    typeof body.rootPath === "string" && body.rootPath.trim()
      ? body.rootPath.trim()
      : "/";
  const limit = Math.max(
    1,
    Math.min(500, Number(body.limit) || 30)
  );
  const reconcileOnly = body.reconcileOnly === true;

  if (!userId) {
    return NextResponse.json({ error: "userId wajib" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
  }

  const active = await prisma.scanJob.findFirst({
    where: activeScanJobWhere(userId),
  });
  if (active) {
    return NextResponse.json(
      { error: "User masih punya job aktif", jobId: active.id },
      { status: 409 }
    );
  }

  const job = await prisma.scanJob.create({
    data: {
      status: ScanJobStatus.PENDING,
      triggeredById: userId,
      jobType: reconcileOnly ? "reconcile_only" : "delta_sync",
      selectedPaths: JSON.stringify({
        rootPath,
        limit: reconcileOnly ? 0 : limit,
        reconcileOnly,
      }),
    },
  });

  await enqueueScanJob(job.id, job.jobType);

  await writeAudit("admin.scan.trigger", session!.user.id, {
    targetUserId: userId,
    jobId: job.id,
    rootPath,
    limit,
    reconcileOnly,
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}
