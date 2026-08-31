import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueScanJob } from "@/lib/queue";
import { activeScanJobWhere } from "@/lib/scan-status";
import { isIngestibleFileName } from "@/lib/file-types";
import { syncBatchSize } from "@/lib/sync-defaults";
import {
  EMPTY_FILE_WARNING,
  legacyEmptyFailedWhere,
  legacyEmptyFileOrConditions,
} from "@/lib/empty-file-sync";

export function retryBatchCap(): number {
  const n = syncBatchSize();
  return n > 0 ? n : 750;
}

/** Move legacy FAILED empty stubs to SKIPPED warning (idempotent). */
export async function migrateLegacyEmptyFailedToWarnings(): Promise<number> {
  const result = await prisma.syncFile.updateMany({
    where: legacyEmptyFailedWhere(),
    data: {
      syncStatus: SyncStatus.SKIPPED,
      errorMessage: EMPTY_FILE_WARNING,
      ocrPendingAt: null,
    },
  });
  return result.count;
}

/** FAILED files still eligible for worker auto-retry (exactly one failure recorded). */
export function isAutoRetryEligible(ingestRetryCount: number): boolean {
  return ingestRetryCount === 1;
}

async function queuePathsForRetry(
  userId: string,
  paths: string[],
  source: string
): Promise<{ jobId: string; totalFiles: number; maxFiles: number }> {
  const batchCap = retryBatchCap();
  const active = await prisma.scanJob.findFirst({
    where: activeScanJobWhere(userId),
    select: { id: true },
  });
  if (active) {
    throw new Error(`Job aktif: ${active.id}`);
  }

  const filtered = paths
    .filter((p) =>
      isIngestibleFileName(p.split("/").filter(Boolean).pop() ?? p, null)
    )
    .slice(0, batchCap);

  if (filtered.length === 0) {
    throw new Error("Tidak ada file gagal untuk diulang");
  }

  for (const remotePath of filtered) {
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
      jobType: "ingest_paths",
      selectedPaths: JSON.stringify({
        mode: "paths",
        paths: filtered,
        source,
      }),
      totalFiles: filtered.length,
    },
  });

  await enqueueScanJob(job.id, "ingest_paths");

  return { jobId: job.id, totalFiles: filtered.length, maxFiles: batchCap };
}

export async function retryFailedFilesForUser(
  userId: string,
  options?: { batchCap?: number }
): Promise<{ jobId: string; totalFiles: number; maxFiles: number }> {
  await migrateLegacyEmptyFailedToWarnings();

  const batchCap = options?.batchCap ?? retryBatchCap();

  const failed = await prisma.syncFile.findMany({
    where: {
      userId,
      syncStatus: SyncStatus.FAILED,
      NOT: { OR: legacyEmptyFileOrConditions() },
    },
    select: { remotePath: true },
    orderBy: { updatedAt: "asc" },
    take: batchCap,
  });

  return queuePathsForRetry(
    userId,
    failed.map((f) => f.remotePath),
    "manual_retry"
  );
}

export async function retryPathsForUser(
  userId: string,
  paths: string[]
): Promise<{ jobId: string; totalFiles: number; maxFiles: number }> {
  const normalized = [
    ...new Set(
      paths
        .filter((p) => typeof p === "string" && p.length > 0)
        .map((p) => (p.startsWith("/") ? p : `/${p}`))
    ),
  ];
  return queuePathsForRetry(userId, normalized, "manual_retry");
}

export async function retryFailedFilesForAllUsers(
  credsUserIds: string[]
): Promise<{
  enqueued: Array<{ userId: string; jobId: string; totalFiles: number }>;
  skipped: Array<{ userId: string; reason: string }>;
}> {
  const enqueued: Array<{ userId: string; jobId: string; totalFiles: number }> =
    [];
  const skipped: Array<{ userId: string; reason: string }> = [];

  for (const userId of credsUserIds) {
    try {
      const result = await retryFailedFilesForUser(userId);
      enqueued.push({
        userId,
        jobId: result.jobId,
        totalFiles: result.totalFiles,
      });
    } catch (err) {
      skipped.push({
        userId,
        reason: err instanceof Error ? err.message : "Gagal",
      });
    }
  }

  return { enqueued, skipped };
}
