import { SyncStatus } from "@prisma/client";
import { prisma } from "./db.js";

/** Max auto-retry attempts for FAILED files (manual retry still allowed). */
export function ingestMaxRetries(): number {
  const n = Number(process.env.INGEST_MAX_RETRY_COUNT ?? "5");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export async function markSyncFileFailed(
  userId: string,
  remotePath: string,
  errorMessage: string
): Promise<void> {
  await prisma.syncFile.updateMany({
    where: { userId, remotePath },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage,
      ingestRetryCount: { increment: 1 },
      ocrPendingAt: null,
    },
  });
}

export async function markSyncFileFailedById(
  id: string,
  errorMessage: string
): Promise<void> {
  await prisma.syncFile.update({
    where: { id },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage,
      ingestRetryCount: { increment: 1 },
      ocrPendingAt: null,
    },
  });
}

export async function markSyncFilesFailedInFlight(
  userId: string,
  reason: string
): Promise<number> {
  const result = await prisma.syncFile.updateMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.QUEUED, SyncStatus.DOWNLOADING] },
    },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage: reason,
      ingestRetryCount: { increment: 1 },
      ocrPendingAt: null,
    },
  });
  return result.count;
}
