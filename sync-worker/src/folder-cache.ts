import { prisma } from "./db.js";

export type FolderSnapshotRow = {
  dirLastModified: Date | null;
  dirEtag: string | null;
};

type PendingSnapshot = {
  userId: string;
  folderPath: string;
  dirLastModified: Date | null;
  dirEtag: string | null;
};

function folderSnapshotBatchSize(): number {
  const n = Number(process.env.FOLDER_SNAPSHOT_BATCH_SIZE ?? "25");
  if (!Number.isFinite(n)) return 25;
  return Math.min(100, Math.max(5, Math.floor(n)));
}

function isDbPressureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /too many (database )?clients|too many connections|P2037|connection pool/i.test(
      msg
    )
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Coalesce rapid discovery writes; one path keeps latest meta. */
const pending = new Map<string, PendingSnapshot>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let flushChain: Promise<void> = Promise.resolve();

function pendingKey(userId: string, folderPath: string): string {
  return `${userId}\0${folderPath}`;
}

function scheduleFlush(immediate = false): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(
    () => {
      flushTimer = null;
      flushChain = flushChain.then(() => flushPendingFolderSnapshots());
    },
    immediate ? 0 : 250
  );
}

async function flushBatch(rows: PendingSnapshot[]): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date();
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Single connection for the whole batch (cuts pool pressure vs N parallel upserts).
      await prisma.$transaction(
        async (tx) => {
          for (const row of rows) {
            await tx.cloudFolderSnapshot.upsert({
              where: {
                userId_folderPath: {
                  userId: row.userId,
                  folderPath: row.folderPath,
                },
              },
              create: {
                userId: row.userId,
                folderPath: row.folderPath,
                dirLastModified: row.dirLastModified,
                dirEtag: row.dirEtag,
                lastListedAt: now,
              },
              update: {
                dirLastModified: row.dirLastModified,
                dirEtag: row.dirEtag,
                lastListedAt: now,
              },
            });
          }
        },
        { timeout: 60_000, maxWait: 20_000 }
      );
      return;
    } catch (err) {
      if (!isDbPressureError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      const waitMs = Math.min(30_000, 1000 * 2 ** attempt);
      console.warn(
        `[folder-snapshot] DB busy, retry batch=${rows.length} in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }
}

/** Flush queued folder snapshots (call at end of discovery). */
export async function flushPendingFolderSnapshots(): Promise<void> {
  if (flushing) {
    await flushChain;
    return;
  }
  flushing = true;
  try {
    while (pending.size > 0) {
      const batchSize = folderSnapshotBatchSize();
      const batch: PendingSnapshot[] = [];
      for (const [key, row] of pending) {
        pending.delete(key);
        batch.push(row);
        if (batch.length >= batchSize) break;
      }
      try {
        await flushBatch(batch);
      } catch (err) {
        // Snapshot is an optimization; never kill the whole sync job.
        console.warn(
          `[folder-snapshot] drop batch=${batch.length}:`,
          err instanceof Error ? err.message : err
        );
      }
      // Brief yield so Paperless/OCR can use the pool between batches.
      if (pending.size > 0) await sleep(50);
    }
  } finally {
    flushing = false;
  }
}

export async function loadFolderSnapshots(
  userId: string,
  rootPrefix: string | null
): Promise<Map<string, FolderSnapshotRow>> {
  const rows = await prisma.cloudFolderSnapshot.findMany({
    where: {
      userId,
      ...(rootPrefix
        ? {
            OR: [
              { folderPath: rootPrefix },
              { folderPath: { startsWith: `${rootPrefix}/` } },
            ],
          }
        : {}),
    },
    select: {
      folderPath: true,
      dirLastModified: true,
      dirEtag: true,
    },
  });
  const map = new Map<string, FolderSnapshotRow>();
  for (const r of rows) {
    map.set(r.folderPath, {
      dirLastModified: r.dirLastModified,
      dirEtag: r.dirEtag,
    });
  }
  return map;
}

/**
 * Queue folder snapshot write (batched). Safe under WebDAV discovery concurrency.
 * Never throws for DB pressure after retries inside flush.
 */
export async function upsertFolderSnapshot(
  userId: string,
  folderPath: string,
  dirLastModified: Date | null,
  dirEtag: string | null
): Promise<void> {
  pending.set(pendingKey(userId, folderPath), {
    userId,
    folderPath,
    dirLastModified,
    dirEtag,
  });
  const immediate = pending.size >= folderSnapshotBatchSize();
  scheduleFlush(immediate);
  // Keep a soft cap so memory does not grow unbounded on huge trees.
  if (pending.size >= folderSnapshotBatchSize() * 4) {
    await flushPendingFolderSnapshots();
  }
}

export function shouldSkipFolderListing(
  snapshot: FolderSnapshotRow | undefined,
  dirLastModified: Date | null,
  dirEtag: string | null
): boolean {
  if (!snapshot) return false;
  if (dirEtag && snapshot.dirEtag && dirEtag === snapshot.dirEtag) return true;
  if (
    dirLastModified &&
    snapshot.dirLastModified &&
    dirLastModified.getTime() === snapshot.dirLastModified.getTime()
  ) {
    return true;
  }
  return false;
}
