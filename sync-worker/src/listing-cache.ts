import { prisma } from "./db.js";
import { connection } from "./scan-queues.js";
import {
  createWebDavClient,
  type DirectoryListing,
} from "./webdav.js";

type CachedDirectoryListing = {
  entries: DirectoryListing["entries"];
  dirEtag: string | null;
  dirLastModified: string | null;
  cachedAt: string;
  expiresAt: string;
};

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function listingCacheKey(userId: string, path: string): string {
  const norm = normalizePath(path);
  return `cloud:listing:${userId}:${encodeURIComponent(norm)}`;
}

function subtreeHintKey(userId: string, path: string): string {
  const norm = normalizePath(path);
  return `cloud:subtree-hint:${userId}:${encodeURIComponent(norm)}`;
}

const liveSummaryKey = (userId: string) => `cloud:live-summary:${userId}`;

function listingTtlSec(): number {
  const n = Number(process.env.CLOUD_LISTING_CACHE_TTL_SEC ?? 600);
  return Number.isFinite(n) && n > 30 ? Math.floor(n) : 600;
}

function postSyncWarmEnabled(): boolean {
  return (process.env.POST_SYNC_WARM_ENABLED ?? "true") !== "false";
}

function postSyncWarmMaxDirs(): number {
  const n = Number(process.env.POST_SYNC_WARM_MAX_DIRS ?? 16);
  if (!Number.isFinite(n)) return 16;
  return Math.min(48, Math.max(1, Math.floor(n)));
}

export function foldersToInvalidate(seedPaths: string[]): string[] {
  const set = new Set<string>();
  set.add("/");

  for (const raw of seedPaths) {
    if (!raw?.trim()) continue;
    const norm = normalizePath(raw);
    const parts = norm.split("/").filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
      set.add("/" + parts.slice(0, i + 1).join("/"));
    }

    if (parts.length > 1) {
      set.add("/" + parts.slice(0, -1).join("/"));
    }
  }

  return [...set];
}

export function seedPathsFromJobPayload(selectedPaths: string | null): string[] {
  if (!selectedPaths) return ["/"];
  try {
    const p = JSON.parse(selectedPaths) as Record<string, unknown>;
    if (Array.isArray(p.paths)) {
      return p.paths.filter((x): x is string => typeof x === "string");
    }
    if (typeof p.rootPath === "string" && p.rootPath.trim()) {
      return [p.rootPath.trim()];
    }
  } catch {
    // ignore
  }
  return ["/"];
}

async function upsertFolderSnapshot(
  userId: string,
  folderPath: string,
  dirLastModified: string | null,
  dirEtag: string | null
): Promise<void> {
  const norm = normalizePath(folderPath);
  const lastMod = dirLastModified ? new Date(dirLastModified) : null;
  await prisma.cloudFolderSnapshot.upsert({
    where: { userId_folderPath: { userId, folderPath: norm } },
    create: {
      userId,
      folderPath: norm,
      dirLastModified: lastMod,
      dirEtag: dirEtag,
      lastListedAt: new Date(),
    },
    update: {
      dirLastModified: lastMod,
      dirEtag: dirEtag,
      lastListedAt: new Date(),
    },
  });
}

async function storeListingCache(
  userId: string,
  path: string,
  listing: DirectoryListing
): Promise<CachedDirectoryListing> {
  const ttl = listingTtlSec();
  const now = new Date();
  const cached: CachedDirectoryListing = {
    entries: listing.entries,
    dirEtag: listing.dirEtag,
    dirLastModified: listing.dirLastModified,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
  };
  await connection.set(
    listingCacheKey(userId, path),
    JSON.stringify(cached),
    "EX",
    ttl
  );
  await upsertFolderSnapshot(
    userId,
    path,
    listing.dirLastModified,
    listing.dirEtag
  );
  return cached;
}

async function warmListingPath(
  userId: string,
  client: ReturnType<typeof createWebDavClient>,
  path: string
): Promise<CachedDirectoryListing | null> {
  const norm = normalizePath(path);
  const listing = await client.listDirectory(norm);
  return storeListingCache(userId, norm, listing);
}

async function warmListingCaches(
  userId: string,
  creds: { url: string; username: string; password: string },
  seedPaths: string[]
): Promise<{ warmed: number; failed: number }> {
  const client = createWebDavClient(creds.url, creds.username, creds.password);
  const maxDirs = postSyncWarmMaxDirs();
  const paths = new Set<string>(foldersToInvalidate(seedPaths));

  const roots = seedPaths
    .map((p) => normalizePath(p))
    .filter((p, i, arr) => arr.indexOf(p) === i);
  const primaryRoot = roots[0] ?? "/";

  let warmed = 0;
  let failed = 0;

  try {
    const rootListing = await warmListingPath(userId, client, primaryRoot);
    warmed++;
    if (rootListing) {
      for (const entry of rootListing.entries) {
        if (entry.type !== "directory") continue;
        if (paths.size >= maxDirs) break;
        paths.add(normalizePath(entry.path));
      }
    }
  } catch (err) {
    failed++;
    console.warn(
      `[cache-warm] root ${primaryRoot} failed:`,
      err instanceof Error ? err.message : err
    );
  }

  const toWarm = [...paths]
    .filter((p) => normalizePath(p) !== normalizePath(primaryRoot))
    .slice(0, maxDirs);

  for (const path of toWarm) {
    try {
      await warmListingPath(userId, client, path);
      warmed++;
    } catch (err) {
      failed++;
      console.warn(
        `[cache-warm] ${path} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (warmed > 0) {
    console.log(
      `[cache-warm] user ${userId}: warmed ${warmed} folder(s), failed ${failed}`
    );
  }

  return { warmed, failed };
}

export async function invalidateCloudCaches(
  userId: string,
  seedPaths: string[]
): Promise<void> {
  const folders = foldersToInvalidate(seedPaths);
  const redis = connection;
  const ops: Promise<unknown>[] = folders.map((folder) =>
    redis.del(listingCacheKey(userId, folder))
  );
  ops.push(
    ...folders.map((folder) => redis.del(subtreeHintKey(userId, folder)))
  );
  ops.push(redis.del(liveSummaryKey(userId)));
  await Promise.all(ops);
}

export async function invalidateAfterScanJob(
  userId: string,
  selectedPaths: string | null,
  extraPaths: string[] = [],
  creds?: { url: string; username: string; password: string } | null
): Promise<void> {
  const seeds = [...seedPathsFromJobPayload(selectedPaths), ...extraPaths];
  await invalidateCloudCaches(userId, seeds);

  if (creds && postSyncWarmEnabled()) {
    try {
      await warmListingCaches(userId, creds, seeds);
    } catch (err) {
      console.warn(
        `[cache-warm] user ${userId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
