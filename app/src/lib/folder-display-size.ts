import type { CloudFolderHint } from "@/lib/cloud-folder-hint";
import type { FolderStats } from "@/lib/folder-stats";

/** Best available folder size: max of tracked subtree vs cached cloud listing. */
export function folderDisplaySizeBytes(
  stats: FolderStats | null | undefined,
  hint: CloudFolderHint | null | undefined
): number | null {
  const tracked = stats?.totalSize ?? 0;
  const cloud = hint?.totalDocSize ?? 0;
  const total = Math.max(tracked, cloud);
  return total > 0 ? total : null;
}
