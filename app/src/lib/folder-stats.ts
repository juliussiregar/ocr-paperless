export type FolderStats = {
  pdfCount: number;
  scannedCount: number;
  pendingCount: number;
  failedCount: number;
  processingCount: number;
  zeroByteCount: number;
  totalSize: number;
};

export function emptyFolderStats(): FolderStats {
  return {
    pdfCount: 0,
    scannedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    processingCount: 0,
    zeroByteCount: 0,
    totalSize: 0,
  };
}

function normalizeBrowsePath(path: string): string {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

/** Map sync files under a browse path to immediate child folder stats. */
export function buildFolderStatsMap(
  parentPath: string,
  dirPaths: string[],
  syncFiles: Array<{
    remotePath: string;
    syncStatus: string;
    fileSize: bigint | number | null;
  }>
): Map<string, FolderStats> {
  const dirSet = new Set(dirPaths);
  const map = new Map<string, FolderStats>();
  for (const d of dirPaths) map.set(d, emptyFolderStats());

  const parentNorm = normalizeBrowsePath(parentPath);
  if (dirPaths.length === 0 || syncFiles.length === 0) return map;

  for (const file of syncFiles) {
    const folder = resolveImmediateChildFolder(
      file.remotePath,
      parentNorm,
      dirSet
    );
    if (!folder) continue;

    const stats = map.get(folder)!;
    stats.pdfCount += 1;

    const size =
      file.fileSize != null ? Number(file.fileSize) : 0;
    stats.totalSize += size;
    if (size === 0) stats.zeroByteCount += 1;

    switch (file.syncStatus) {
      case "OCR_DONE":
      case "SKIPPED":
        stats.scannedCount += 1;
        break;
      case "FAILED":
        stats.failedCount += 1;
        break;
      case "DOWNLOADING":
      case "QUEUED":
      case "OCR_PENDING":
        stats.processingCount += 1;
        break;
      default:
        stats.pendingCount += 1;
    }
  }

  return map;
}

/** Prisma filter: sync files under immediate child folders only (not whole browse tree). */
export function nestedSyncFileFilter(
  userId: string,
  dirPaths: string[]
): {
  userId: string;
  OR: Array<{ remotePath: { startsWith: string } }>;
} | null {
  if (dirPaths.length === 0) return null;
  return {
    userId,
    OR: dirPaths.map((d) => ({
      remotePath: { startsWith: `${normalizeBrowsePath(d)}/` },
    })),
  };
}

function resolveImmediateChildFolder(
  remotePath: string,
  parentPath: string,
  dirSet: Set<string>
): string | null {
  if (parentPath === "/") {
    if (!remotePath.startsWith("/")) return null;
    const rest = remotePath.slice(1);
    const seg = rest.split("/")[0];
    if (!seg) return null;
    const child = `/${seg}`;
    return dirSet.has(child) ? child : null;
  }

  const prefix = `${parentPath}/`;
  if (!remotePath.startsWith(prefix)) return null;
  const rest = remotePath.slice(prefix.length);
  const seg = rest.split("/")[0];
  if (!seg) return null;
  const child = `${parentPath}/${seg}`;
  return dirSet.has(child) ? child : null;
}
