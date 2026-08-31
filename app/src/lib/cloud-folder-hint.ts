import type { CloudEntry } from "@/lib/webdav";

export type CloudFolderHint = {
  isEmpty: boolean;
  /** Ingestible documents in immediate listing (not recursive). */
  docCount: number;
  totalDocSize: number;
  zeroByteDocs: number;
  dirCount: number;
  fileCount: number;
  /** Legacy aliases (same as docCount / totalDocSize). */
  pdfCount: number;
  totalPdfSize: number;
  zeroBytePdfs: number;
};

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
  };
}
