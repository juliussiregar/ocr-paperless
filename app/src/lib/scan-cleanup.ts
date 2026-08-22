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

export function scanMaxFilesFromEnv(): number {
  const n = Number(process.env.SCAN_MAX_FILES ?? "50");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}
