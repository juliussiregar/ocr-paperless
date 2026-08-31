import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/queue";
import {
  createUserWebDav,
  type CloudEntry,
  type DirectoryListing,
} from "@/lib/webdav";

export type CachedDirectoryListing = {
  entries: CloudEntry[];
  dirEtag: string | null;
  dirLastModified: string | null;
  cachedAt: string;
  expiresAt: string;
};

export type ListingFetchResult = DirectoryListing & {
  listingCached: boolean;
  listingStale: boolean;
  listingCachedAt: string | null;
};

function normalizeListingPath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function cacheKey(userId: string, path: string): string {
  const norm = normalizeListingPath(path);
  const encoded = encodeURIComponent(norm);
  return `cloud:listing:${userId}:${encoded}`;
}

function listingTtlSec(): number {
  const n = Number(process.env.CLOUD_LISTING_CACHE_TTL_SEC ?? 600);
  return Number.isFinite(n) && n > 30 ? Math.floor(n) : 600;
}

export { listingTtlSec };

function subtreeHintKey(userId: string, path: string): string {
  const norm = normalizeListingPath(path);
  return `cloud:subtree-hint:${userId}:${encodeURIComponent(norm)}`;
}

export async function getCachedSubtreeHint(
  userId: string,
  path: string
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await getRedis().get(subtreeHintKey(userId, path));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function storeCachedSubtreeHint(
  userId: string,
  path: string,
  hint: Record<string, unknown>
): Promise<void> {
  const ttl = listingTtlSec();
  await getRedis().set(
    subtreeHintKey(userId, path),
    JSON.stringify(hint),
    "EX",
    ttl
  );
}

export async function invalidateSubtreeHintCache(
  userId: string,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  const keys = paths.map((p) => subtreeHintKey(userId, p));
  await getRedis().del(...keys);
}

export async function warmListingCaches(
  userId: string,
  paths: string[],
  creds: { url: string; username: string; password: string },
  options?: { max?: number }
): Promise<{ warmed: string[]; cached: string[]; failed: string[] }> {
  const max = Math.min(options?.max ?? 16, paths.length);
  const warmed: string[] = [];
  const cached: string[] = [];
  const failed: string[] = [];

  for (const raw of paths.slice(0, max)) {
    const path = normalizeListingPath(raw);
    try {
      const existing = await getCachedListing(userId, path);
      if (existing) {
        cached.push(path);
        continue;
      }
      await fetchDirectoryListing(userId, path, creds, { refresh: false });
      warmed.push(path);
    } catch {
      failed.push(path);
    }
  }

  return { warmed, cached, failed };
}

export async function getCachedListing(
  userId: string,
  path: string
): Promise<CachedDirectoryListing | null> {
  const raw = await getRedis().get(cacheKey(userId, path));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedDirectoryListing;
    if (!parsed?.cachedAt || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isExpired(cached: CachedDirectoryListing): boolean {
  const exp = Date.parse(cached.expiresAt);
  return Number.isFinite(exp) && Date.now() >= exp;
}

async function upsertFolderSnapshot(
  userId: string,
  folderPath: string,
  dirLastModified: string | null,
  dirEtag: string | null
): Promise<void> {
  const norm = normalizeListingPath(folderPath);
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
  await getRedis().set(
    cacheKey(userId, path),
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

export async function fetchDirectoryListing(
  userId: string,
  path: string,
  creds: { url: string; username: string; password: string },
  options: { refresh?: boolean } = {}
): Promise<ListingFetchResult> {
  const refresh = options.refresh === true;
  const cached = refresh ? null : await getCachedListing(userId, path);

  if (cached && !refresh) {
    return {
      entries: cached.entries,
      dirEtag: cached.dirEtag,
      dirLastModified: cached.dirLastModified,
      listingCached: true,
      listingStale: isExpired(cached),
      listingCachedAt: cached.cachedAt,
    };
  }

  const client = createUserWebDav(creds.url, creds.username, creds.password);
  const listing = await client.listDirectory(path);
  const stored = await storeListingCache(userId, path, listing);

  return {
    entries: listing.entries,
    dirEtag: listing.dirEtag,
    dirLastModified: listing.dirLastModified,
    listingCached: Boolean(cached),
    listingStale: false,
    listingCachedAt: stored.cachedAt,
  };
}

export async function invalidateListingCache(
  userId: string,
  path: string
): Promise<void> {
  const norm = normalizeListingPath(path);
  await getRedis().del(cacheKey(userId, norm));
  await invalidateSubtreeHintCache(userId, [norm]);
}
