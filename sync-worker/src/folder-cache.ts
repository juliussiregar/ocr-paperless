import { prisma } from "./db.js";

export type FolderSnapshotRow = {
  dirLastModified: Date | null;
  dirEtag: string | null;
};

function folderUpsertConcurrency(): number {
  const n = Number(process.env.FOLDER_SNAPSHOT_UPSERT_CONCURRENCY ?? "4");
  if (!Number.isFinite(n)) return 4;
  return Math.min(16, Math.max(1, Math.floor(n)));
}

let upsertActive = 0;
const upsertWaiters: Array<() => void> = [];

async function withFolderUpsertSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = folderUpsertConcurrency();
  if (upsertActive >= max) {
    await new Promise<void>((resolve) => {
      upsertWaiters.push(resolve);
    });
  }
  upsertActive += 1;
  try {
    return await fn();
  } finally {
    upsertActive -= 1;
    const next = upsertWaiters.shift();
    if (next) next();
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

export async function upsertFolderSnapshot(
  userId: string,
  folderPath: string,
  dirLastModified: Date | null,
  dirEtag: string | null
): Promise<void> {
  await withFolderUpsertSlot(() =>
    prisma.cloudFolderSnapshot.upsert({
      where: { userId_folderPath: { userId, folderPath } },
      create: {
        userId,
        folderPath,
        dirLastModified,
        dirEtag,
        lastListedAt: new Date(),
      },
      update: {
        dirLastModified,
        dirEtag,
        lastListedAt: new Date(),
      },
    })
  );
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
