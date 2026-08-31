import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

/** Mark QUEUED/DOWNLOADING as FAILED (cancel / cleanup). OCR_PENDING stays. */
export async function abandonInFlightSyncFiles(
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
    },
  });
  return result.count;
}

import { syncBatchSize } from "@/lib/sync-defaults";

export function scanMaxFilesFromEnv(): number {
  return syncBatchSize();
}
