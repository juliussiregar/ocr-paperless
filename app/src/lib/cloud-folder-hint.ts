import type { CloudEntry } from "@/lib/webdav";

export type CloudFolderHint = {
  isEmpty: boolean;
  pdfCount: number;
  totalPdfSize: number;
  zeroBytePdfs: number;
  dirCount: number;
  fileCount: number;
};

export function emptyCloudFolderHint(): CloudFolderHint {
  return {
    isEmpty: true,
    pdfCount: 0,
    totalPdfSize: 0,
    zeroBytePdfs: 0,
    dirCount: 0,
    fileCount: 0,
  };
}

/** Summarize immediate children of a folder (non-recursive). */
export function summarizeCloudFolder(entries: CloudEntry[]): CloudFolderHint {
  if (entries.length === 0) return emptyCloudFolderHint();

  let pdfCount = 0;
  let totalPdfSize = 0;
  let zeroBytePdfs = 0;
  let dirCount = 0;

  for (const entry of entries) {
    if (entry.type === "directory") {
      dirCount += 1;
      continue;
    }
    if (!entry.isPdf) continue;
    pdfCount += 1;
    const size = entry.size ?? 0;
    totalPdfSize += size;
    if (entry.size === 0) zeroBytePdfs += 1;
  }

  return {
    isEmpty: false,
    pdfCount,
    totalPdfSize,
    zeroBytePdfs,
    dirCount,
    fileCount: entries.length,
  };
}
