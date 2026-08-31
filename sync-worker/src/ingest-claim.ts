import { SyncStatus } from "@prisma/client";
import { prisma } from "./db.js";

const CLAIMABLE: SyncStatus[] = [
  SyncStatus.DISCOVERED,
  SyncStatus.QUEUED,
  SyncStatus.FAILED,
];

const BUSY: SyncStatus[] = [
  SyncStatus.DOWNLOADING,
  SyncStatus.OCR_PENDING,
  SyncStatus.QUEUED,
];

/**
 * Atomically claim a path for ingest. Returns false if another worker
 * already holds it or the file is already done.
 */
export async function claimSyncFileForIngest(
  userId: string,
  remotePath: string,
  opts?: { fileId?: string | null }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (opts?.fileId) {
    const busyPeer = await prisma.syncFile.findFirst({
      where: {
        userId,
        remoteFileId: opts.fileId,
        syncStatus: { in: BUSY },
        NOT: { remotePath },
      },
      select: { remotePath: true, syncStatus: true },
    });
    if (busyPeer) {
      return {
        ok: false,
        reason: `fileId sibuk di ${busyPeer.remotePath} (${busyPeer.syncStatus})`,
      };
    }
  }

  const claimed = await prisma.syncFile.updateMany({
    where: {
      userId,
      remotePath,
      syncStatus: { in: CLAIMABLE },
    },
    data: {
      syncStatus: SyncStatus.DOWNLOADING,
      errorMessage: null,
    },
  });
  if (claimed.count > 0) return { ok: true };

  const row = await prisma.syncFile.findUnique({
    where: { userId_remotePath: { userId, remotePath } },
    select: { syncStatus: true },
  });
  if (!row) {
    // New path: create as DOWNLOADING via caller upsert
    return { ok: true };
  }
  if (
    row.syncStatus === SyncStatus.OCR_DONE ||
    row.syncStatus === SyncStatus.SKIPPED
  ) {
    return { ok: false, reason: "sudah selesai" };
  }
  if (row.syncStatus === SyncStatus.DOWNLOADING) {
    return { ok: false, reason: "sudah di-download worker lain" };
  }
  if (row.syncStatus === SyncStatus.OCR_PENDING) {
    return { ok: false, reason: "menunggu OCR" };
  }
  return { ok: false, reason: `status ${row.syncStatus}` };
}
