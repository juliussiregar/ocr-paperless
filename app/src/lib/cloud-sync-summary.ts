import type { FileCategory } from "@/lib/file-types";
import {
  emptyTypeCounts,
  fileCategoryFromExtension,
  FILE_CATEGORY_LABELS,
} from "@/lib/file-types";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/queue";
import { createUserWebDav } from "@/lib/webdav";
import { SyncStatus } from "@prisma/client";

const PENDING_STATUSES: SyncStatus[] = [
  SyncStatus.DISCOVERED,
  SyncStatus.QUEUED,
  SyncStatus.DOWNLOADING,
  SyncStatus.OCR_PENDING,
];

export type TrackedSummary = {
  detected: number;
  downloaded: number;
  failed: number;
  pending: number;
  indexed: number;
  byType: Record<FileCategory, number>;
  typeBreakdown: Array<{ key: FileCategory; label: string; count: number }>;
};

export type LiveSummary = {
  documentCount: number;
  totalSize: number;
  zeroByteCount: number;
  byType: Record<FileCategory, number>;
  typeBreakdown: Array<{ key: FileCategory; label: string; count: number }>;
  truncated: boolean;
  dirsVisited: number;
  cachedAt: string;
  expiresAt: string;
};

const CACHE_KEY = (userId: string) => `cloud:live-summary:${userId}`;
const LOCK_KEY = (userId: string) => `cloud:live-summary:lock:${userId}`;

function cacheTtlSec(): number {
  const n = Number(process.env.CLOUD_LIVE_SUMMARY_TTL_SEC ?? 1800);
  return Number.isFinite(n) && n > 60 ? Math.floor(n) : 1800;
}

function liveScanMaxDirs(): number {
  const n = Number(process.env.CLOUD_LIVE_SCAN_MAX_DIRS ?? 2000);
  return Number.isFinite(n) && n > 50 ? Math.floor(n) : 2000;
}

function typeBreakdownFromCounts(
  byType: Record<FileCategory, number>
): TrackedSummary["typeBreakdown"] {
  return (Object.keys(byType) as FileCategory[])
    .map((key) => ({
      key,
      label: FILE_CATEGORY_LABELS[key],
      count: byType[key],
    }))
    .filter((row) => row.count > 0);
}

export async function buildTrackedSummary(
  userId: string
): Promise<TrackedSummary> {
  const statusGroups = await prisma.syncFile.groupBy({
    by: ["syncStatus"],
    where: { userId, syncStatus: { not: SyncStatus.DELETED } },
    _count: { _all: true },
  });

  let detected = 0;
  let downloaded = 0;
  let failed = 0;
  let pending = 0;
  let indexed = 0;

  for (const row of statusGroups) {
    const count = row._count._all;
    detected += count;

    switch (row.syncStatus) {
      case SyncStatus.OCR_DONE:
        indexed += count;
        downloaded += count;
        break;
      case SyncStatus.SKIPPED:
        downloaded += count;
        break;
      case SyncStatus.FAILED:
        failed += count;
        break;
      default:
        if (PENDING_STATUSES.includes(row.syncStatus)) {
          pending += count;
        }
        break;
    }
  }

  const extRows = await prisma.$queryRaw<Array<{ ext: string | null; count: bigint }>>`
    SELECT lower(substring(file_name from '\\.([^\\.]+)$')) AS ext, count(*)::bigint AS count
    FROM sync_files
    WHERE user_id = ${userId} AND sync_status != 'DELETED'
    GROUP BY 1
  `;

  const byType = emptyTypeCounts();
  for (const row of extRows) {
    const cat = fileCategoryFromExtension(row.ext ?? "");
    byType[cat] += Number(row.count);
  }

  return {
    detected,
    downloaded,
    failed,
    pending,
    indexed,
    byType,
    typeBreakdown: typeBreakdownFromCounts(byType),
  };
}

export async function getLiveSummaryCache(
  userId: string
): Promise<LiveSummary | null> {
  const raw = await getRedis().get(CACHE_KEY(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LiveSummary;
    if (!parsed?.cachedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function isLiveScanInProgress(userId: string): Promise<boolean> {
  const lock = await getRedis().get(LOCK_KEY(userId));
  return lock === "1";
}

export async function tryAcquireLiveScanLock(userId: string): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(LOCK_KEY(userId), "1", "EX", 300, "NX");
  return result === "OK";
}

export async function releaseLiveScanLock(userId: string): Promise<void> {
  await getRedis().del(LOCK_KEY(userId));
}

export async function scanAndCacheLiveSummary(userId: string): Promise<LiveSummary> {
  const creds = await getUserBappenasCreds(userId);
  if (!creds) {
    throw new Error("Kredensial Cloud Bappenas belum diisi");
  }

  const client = createUserWebDav(creds.url, creds.username, creds.password);
  const scanned = await client.scanDocuments("/", { maxDirs: liveScanMaxDirs() });

  const now = new Date();
  const ttl = cacheTtlSec();
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const live: LiveSummary = {
    documentCount: scanned.documentCount,
    totalSize: scanned.totalSize,
    zeroByteCount: scanned.zeroByteCount,
    byType: scanned.byType,
    typeBreakdown: typeBreakdownFromCounts(scanned.byType),
    truncated: scanned.truncated,
    dirsVisited: scanned.dirsVisited,
    cachedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await getRedis().set(CACHE_KEY(userId), JSON.stringify(live), "EX", ttl);
  return live;
}

export async function refreshLiveSummary(userId: string): Promise<{
  live: LiveSummary | null;
  liveRefreshing: boolean;
}> {
  const cached = await getLiveSummaryCache(userId);
  const inProgress = await isLiveScanInProgress(userId);

  if (inProgress) {
    return { live: cached, liveRefreshing: true };
  }

  const acquired = await tryAcquireLiveScanLock(userId);
  if (!acquired) {
    return { live: cached, liveRefreshing: true };
  }

  try {
    const live = await scanAndCacheLiveSummary(userId);
    return { live, liveRefreshing: false };
  } finally {
    await releaseLiveScanLock(userId);
  }
}
