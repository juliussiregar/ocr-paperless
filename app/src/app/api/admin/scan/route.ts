import { NextRequest, NextResponse } from "next/server";
import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/session";
import { enqueueScanJob } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { activeScanJobWhere } from "@/lib/scan-status";
import { getAutoScanSettings } from "@/lib/app-settings";
import { SYNC_ROOT_PATH, syncBatchSize } from "@/lib/sync-defaults";
import { getUserBappenasCreds, listUsersWithBappenasCreds } from "@/lib/bappenas";
import { getScanHealth, releaseUserScanLock } from "@/lib/scan-health";
import { triggerDeltaSyncForAllUsers } from "@/lib/admin-sync-trigger";
import {
  retryFailedFilesForAllUsers,
  retryFailedFilesForUser,
} from "@/lib/retry-failed-sync";

function autoRetryEligibleWhere() {
  return { ingestRetryCount: 1 };
}

function autoRetryExhaustedWhere() {
  return { ingestRetryCount: { gte: 2 } };
}

export async function GET() {
  const { error } = await requireAdminApi();
  if (error) return error;

  const credsUserIds = new Set(
    (await listUsersWithBappenasCreds()).map((u) => u.id)
  );
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
              ...autoRetryEligibleWhere(),
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ...autoRetryExhaustedWhere(),
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
        hasBappenasCreds: credsUserIds.has(u.id),
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

  const recentJobs = await prisma.scanJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      jobType: true,
      status: true,
      phase: true,
      totalFiles: true,
      processedFiles: true,
      skippedFiles: true,
      failedFiles: true,
      newFiles: true,
      errorMessage: true,
      currentFile: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      triggeredBy: { select: { id: true, email: true, name: true } },
    },
  });

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
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      jobType: j.jobType,
      status: j.status,
      phase: j.phase,
      totalFiles: j.totalFiles,
      processedFiles: j.processedFiles,
      skippedFiles: j.skippedFiles,
      failedFiles: j.failedFiles,
      newFiles: j.newFiles,
      errorMessage: j.errorMessage,
      currentFile: j.currentFile,
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
      createdAt: j.createdAt.toISOString(),
      durationMs:
        j.startedAt && j.completedAt
          ? j.completedAt.getTime() - j.startedAt.getTime()
          : null,
      user: j.triggeredBy
        ? {
            id: j.triggeredBy.id,
            email: j.triggeredBy.email,
            name: j.triggeredBy.name,
          }
        : null,
    })),
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

  if (body.action === "retryFailed") {
    const allUsers = body.allUsers === true;
    const targetUserId =
      typeof body.userId === "string" ? body.userId : "";

    if (allUsers) {
      const credsUsers = await listUsersWithBappenasCreds();
      const result = await retryFailedFilesForAllUsers(credsUsers.map((u) => u.id));
      await writeAudit("admin.scan.retry_failed", session!.user.id, {
        allUsers: true,
        enqueued: result.enqueued.length,
        skipped: result.skipped.length,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (!targetUserId) {
      return NextResponse.json({ error: "userId wajib" }, { status: 400 });
    }

    const creds = await getUserBappenasCreds(targetUserId);
    if (!creds) {
      return NextResponse.json(
        { error: "User tidak punya kredensial Bappenas yang valid" },
        { status: 400 }
      );
    }

    try {
      const result = await retryFailedFilesForUser(targetUserId);
      await writeAudit("admin.scan.retry_failed", session!.user.id, {
        targetUserId,
        jobId: result.jobId,
        totalFiles: result.totalFiles,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal retry failed";
      const status = message.startsWith("Job aktif") ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (body.action === "triggerAll") {
    const rootPath =
      typeof body.rootPath === "string" && body.rootPath.trim()
        ? body.rootPath.trim()
        : SYNC_ROOT_PATH;
    const reconcileOnly = body.reconcileOnly === true;
    const limit = Math.max(
      1,
      Math.min(500, Number(body.limit) || syncBatchSize())
    );

    try {
      const result = await triggerDeltaSyncForAllUsers(session!.user.id, {
        rootPath,
        limit,
        reconcileOnly,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal trigger sync semua user";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const rootPath =
    typeof body.rootPath === "string" && body.rootPath.trim()
      ? body.rootPath.trim()
      : SYNC_ROOT_PATH;
  const limit = Math.max(
    1,
    Math.min(500, Number(body.limit) || syncBatchSize())
  );
  const reconcileOnly = body.reconcileOnly === true;

  if (!userId) {
    return NextResponse.json({ error: "userId wajib" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
  }

  const creds = await getUserBappenasCreds(userId);
  if (!creds) {
    return NextResponse.json(
      { error: "User tidak punya kredensial Bappenas yang valid" },
      { status: 400 }
    );
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
        forceWalk: !reconcileOnly,
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
