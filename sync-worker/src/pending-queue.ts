import { SyncStatus, type SyncFile } from "@prisma/client";
import { prisma } from "./db.js";
import type { RemoteMeta } from "./sync-meta.js";
import { metadataPatchFromRemote } from "./sync-meta.js";

const IN_FLIGHT: SyncStatus[] = [
  SyncStatus.QUEUED,
  SyncStatus.DOWNLOADING,
  SyncStatus.OCR_PENDING,
];

export function remoteMetaFromSyncRow(row: {
  remotePath: string;
  fileName: string;
  etag: string | null;
  lastModified: Date | null;
  fileSize: bigint | null;
  remoteFileId: string | null;
  mimeType: string | null;
}): RemoteMeta {
  return {
    path: row.remotePath,
    basename: row.fileName,
    etag: row.etag,
    lastModified: row.lastModified,
    size: row.fileSize != null ? Number(row.fileSize) : null,
    fileId: row.remoteFileId,
    mimeType: row.mimeType,
  };
}

function pathUnderRoot(remotePath: string, rootPrefix: string | null): boolean {
  if (!rootPrefix) return true;
  return remotePath === rootPrefix || remotePath.startsWith(`${rootPrefix}/`);
}

export async function countDiscoveredPending(
  userId: string,
  rootPrefix: string | null
): Promise<number> {
  return prisma.syncFile.count({
    where: {
      userId,
      syncStatus: SyncStatus.DISCOVERED,
      ...(rootPrefix
        ? {
            OR: [
              { remotePath: rootPrefix },
              { remotePath: { startsWith: `${rootPrefix}/` } },
            ],
          }
        : {}),
    },
  });
}

/**
 * Chase / preferQueue: drain DISCOVERED only (no walk).
 * Interval auto-scan uses forceWalk separately.
 */
export function shouldDrainQueueOnly(opts: {
  preferQueue: boolean;
  forceWalk: boolean;
}): boolean {
  return opts.preferQueue && !opts.forceWalk;
}

/** Persist overflow candidates so chase can download without another walk. */
export async function upsertDiscoveredOverflow(
  userId: string,
  metas: RemoteMeta[],
  now: Date
): Promise<number> {
  let n = 0;
  for (const meta of metas) {
    const existing = await prisma.syncFile.findUnique({
      where: {
        userId_remotePath: { userId, remotePath: meta.path },
      },
      select: { id: true, syncStatus: true },
    });
    if (existing && IN_FLIGHT.includes(existing.syncStatus)) {
      await prisma.syncFile.update({
        where: { id: existing.id },
        data: metadataPatchFromRemote(meta, now),
      });
      continue;
    }
    if (
      existing &&
      (existing.syncStatus === SyncStatus.OCR_DONE ||
        existing.syncStatus === SyncStatus.SKIPPED)
    ) {
      continue;
    }

    const patch = metadataPatchFromRemote(meta, now);
    if (existing) {
      await prisma.syncFile.update({
        where: { id: existing.id },
        data: {
          ...patch,
          syncStatus: SyncStatus.DISCOVERED,
          errorMessage: null,
        },
      });
    } else {
      await prisma.syncFile.create({
        data: {
          userId,
          remotePath: meta.path,
          fileName: patch.fileName,
          etag: patch.etag,
          lastModified: patch.lastModified,
          fileSize: patch.fileSize,
          mimeType: patch.mimeType,
          remoteFileId: patch.remoteFileId,
          syncStatus: SyncStatus.DISCOVERED,
          lastSeenAt: now,
        },
      });
    }
    n++;
  }
  return n;
}

export async function takeDiscoveredBatch(
  userId: string,
  rootPrefix: string | null,
  limit: number
): Promise<{ paths: string[]; metaByPath: Map<string, RemoteMeta> }> {
  const take =
    !Number.isFinite(limit) || limit <= 0 || limit >= Number.MAX_SAFE_INTEGER / 2
      ? 10_000
      : Math.floor(limit);

  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      syncStatus: SyncStatus.DISCOVERED,
      ...(rootPrefix
        ? {
            OR: [
              { remotePath: rootPrefix },
              { remotePath: { startsWith: `${rootPrefix}/` } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastModified: "desc" }, { updatedAt: "asc" }],
    take,
  });

  if (rows.length === 0) {
    return { paths: [], metaByPath: new Map() };
  }

  await prisma.syncFile.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { syncStatus: SyncStatus.QUEUED, errorMessage: null },
  });

  const metaByPath = new Map<string, RemoteMeta>();
  const paths: string[] = [];
  for (const row of rows) {
    if (rootPrefix && !pathUnderRoot(row.remotePath, rootPrefix)) continue;
    paths.push(row.remotePath);
    metaByPath.set(row.remotePath, remoteMetaFromSyncRow(row));
  }
  return { paths, metaByPath };
}

export type { SyncFile };
