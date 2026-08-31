import type { CloudEntry } from "@/lib/webdav";
import type { CloudFolderHint } from "@/lib/cloud-folder-hint-types";
import {
  getCachedListing,
  getCachedSubtreeHint,
  storeCachedSubtreeHint,
} from "@/lib/cloud-listing-cache";

export type { CloudFolderHint };

export function emptyCloudFolderHint(): CloudFolderHint {
  return {
    isEmpty: true,
    docCount: 0,
    totalDocSize: 0,
    zeroByteDocs: 0,
    dirCount: 0,
    fileCount: 0,
    pdfCount: 0,
    totalPdfSize: 0,
    zeroBytePdfs: 0,
    recursiveComplete: false,
  };
}

/** Summarize immediate children of a folder (non-recursive). */
export function summarizeCloudFolder(entries: CloudEntry[]): CloudFolderHint {
  if (entries.length === 0) return emptyCloudFolderHint();

  let docCount = 0;
  let totalDocSize = 0;
  let zeroByteDocs = 0;
  let dirCount = 0;

  for (const entry of entries) {
    if (entry.type === "directory") {
      dirCount += 1;
      continue;
    }
    if (!entry.isIngestible) continue;
    docCount += 1;
    const size = entry.size ?? 0;
    totalDocSize += size;
    if (entry.size === 0) zeroByteDocs += 1;
  }

  return {
    isEmpty: false,
    docCount,
    totalDocSize,
    zeroByteDocs,
    dirCount,
    fileCount: entries.length,
    pdfCount: docCount,
    totalPdfSize: totalDocSize,
    zeroBytePdfs: zeroByteDocs,
    recursiveComplete: true,
  };
}

function normalizeFolderPath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/** Sum ingestible docs in subtree using Redis listing cache (no WebDAV). */
export async function aggregateCachedSubtreeHint(
  userId: string,
  folderPath: string,
  memo?: Map<string, CloudFolderHint>
): Promise<CloudFolderHint> {
  const norm = normalizeFolderPath(folderPath);
  const cache = memo ?? new Map<string, CloudFolderHint>();
  if (cache.has(norm)) return cache.get(norm)!;

  const redisRaw = await getCachedSubtreeHint(userId, norm);
  if (redisRaw && typeof redisRaw.docCount === "number") {
    const parsed = redisRaw as unknown as CloudFolderHint;
    cache.set(norm, parsed);
    return parsed;
  }

  const empty = { ...emptyCloudFolderHint(), recursiveComplete: false };
  const cached = await getCachedListing(userId, norm);
  if (!cached) {
    cache.set(norm, empty);
    return empty;
  }

  const immediate = summarizeCloudFolder(cached.entries);
  let docCount = immediate.docCount;
  let totalDocSize = immediate.totalDocSize;
  let zeroByteDocs = immediate.zeroByteDocs;
  let dirCount = immediate.dirCount;
  let fileCount = immediate.fileCount;
  let recursiveComplete = true;

  for (const entry of cached.entries) {
    if (entry.type !== "directory") continue;
    const sub = await aggregateCachedSubtreeHint(userId, entry.path, cache);
    docCount += sub.docCount;
    totalDocSize += sub.totalDocSize;
    zeroByteDocs += sub.zeroByteDocs;
    if (!sub.recursiveComplete) recursiveComplete = false;
  }

  const result: CloudFolderHint = {
    isEmpty: docCount === 0 && dirCount === 0,
    docCount,
    totalDocSize,
    zeroByteDocs,
    dirCount,
    fileCount,
    pdfCount: docCount,
    totalPdfSize: totalDocSize,
    zeroBytePdfs: zeroByteDocs,
    recursiveComplete,
  };
  cache.set(norm, result);
  if (recursiveComplete) {
    await storeCachedSubtreeHint(userId, norm, result);
  }
  return result;
}

