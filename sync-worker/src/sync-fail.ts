import { SyncStatus } from "@prisma/client";
import { prisma } from "./db.js";

/** Legacy cap (UI labels). Manual retry is not limited by this. */
export function ingestMaxRetries(): number {
  const n = Number(process.env.INGEST_MAX_RETRY_COUNT ?? "5");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/** How many times worker auto-retry schedule may pick a FAILED file (default 1). */
export function ingestAutoRetryMax(): number {
  const n = Number(process.env.INGEST_AUTO_RETRY_MAX ?? "1");
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.floor(n);
}

/** FAILED with ingestRetryCount=1: failed once, eligible for one auto-retry. */
export function isEligibleForAutoRetry(ingestRetryCount: number): boolean {
  return ingestRetryCount === 1;
}

/** Network / DB blips: do not burn the one-shot auto-retry counter. */
export function isTransientSyncError(
  message: string | null | undefined
): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("too many clients") ||
    m.includes("too many database connections") ||
    m.includes("p2037") ||
    m.includes("503") ||
    m.includes("service unavailable") ||
    m.includes("etimedout") ||
    m.includes("econnreset") ||
    m.includes("socket hang up") ||
    m.includes("econnrefused") ||
    m.includes("fetch failed") ||
    (m.includes("timeout") && m.includes("download"))
  );
}

export async function markSyncFileFailed(
  userId: string,
  remotePath: string,
  errorMessage: string
): Promise<void> {
  const transient = isTransientSyncError(errorMessage);
  await prisma.syncFile.updateMany({
    where: { userId, remotePath },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage,
      ...(transient ? {} : { ingestRetryCount: { increment: 1 } }),
      ocrPendingAt: null,
    },
  });
}

export async function markSyncFileFailedById(
  id: string,
  errorMessage: string
): Promise<void> {
  const transient = isTransientSyncError(errorMessage);
  await prisma.syncFile.update({
    where: { id },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage,
      ...(transient ? {} : { ingestRetryCount: { increment: 1 } }),
      ocrPendingAt: null,
    },
  });
}

export async function markSyncFilesFailedInFlight(
  userId: string,
  reason: string
): Promise<number> {
  const transient = isTransientSyncError(reason);
  const result = await prisma.syncFile.updateMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.QUEUED, SyncStatus.DOWNLOADING] },
    },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage: reason,
      ...(transient ? {} : { ingestRetryCount: { increment: 1 } }),
      ocrPendingAt: null,
    },
  });
  return result.count;
}
