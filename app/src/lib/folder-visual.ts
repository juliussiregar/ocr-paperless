import type { CloudFolderHint } from "@/lib/cloud-folder-hint";
import { folderSiapMetrics } from "@/lib/cloud-folder-hint";
import type { FolderStats } from "@/lib/folder-stats";

export type FolderVisualState =
  | "loading"
  | "empty"
  | "unknown"
  | "cloud_only"
  | "pending"
  | "processing"
  | "partial"
  | "ready"
  | "issue";

export function resolveFolderVisualState(
  stats: FolderStats | null,
  cloudHint: CloudFolderHint | null,
  loading?: boolean
): FolderVisualState {
  if (loading) return "loading";
  if (cloudHint?.isEmpty) return "empty";

  const hasIssue =
    (stats?.failedCount ?? 0) > 0 ||
    (stats?.zeroByteCount ?? 0) > 0 ||
    (cloudHint?.zeroByteDocs ?? 0) > 0 ||
    (cloudHint?.zeroBytePdfs ?? 0) > 0;
  if (hasIssue) return "issue";

  if (stats && stats.pdfCount > 0) {
    if (stats.processingCount > 0) return "processing";
    const cloudDocs = cloudHint?.docCount ?? 0;
    const untrackedGap =
      cloudDocs > 0 ? Math.max(0, cloudDocs - stats.pdfCount) : 0;
    const siap = folderSiapMetrics(stats, cloudHint);
    if (untrackedGap > 0 || (siap && siap.done < siap.total)) {
      if (stats.scannedCount > 0) return "partial";
      if (stats.pendingCount > 0) return "pending";
      return "cloud_only";
    }
    if (stats.scannedCount >= stats.pdfCount) return "ready";
    if (stats.scannedCount > 0) return "partial";
    if (stats.pendingCount > 0) return "pending";
  }

  if (cloudHint && (cloudHint.docCount > 0 || cloudHint.pdfCount > 0)) {
    return "cloud_only";
  }
  if (cloudHint && (cloudHint.dirCount > 0 || cloudHint.fileCount > 0)) {
    return "cloud_only";
  }
  return "unknown";
}

export const FOLDER_VISUAL_LABELS: Record<FolderVisualState, string> = {
  loading: "Memuat info folder",
  empty: "Folder kosong",
  unknown: "Folder (arahkan untuk info cloud)",
  cloud_only: "Ada isi di cloud, belum / sedikit tercatat di sistem",
  pending: "Ada PDF belum discan",
  processing: "Ada PDF sedang diproses",
  partial: "Sebagian PDF sudah siap",
  ready: "Semua PDF tercatat sudah siap",
  issue: "Ada file gagal atau 0 B",
};
