/** Operational sync defaults (not exposed in Admin UI). */

export const SYNC_ROOT_PATH = "/";

export const AUTO_RETRY_INTERVAL_MINUTES = 120;
export const AUTO_RETRY_BATCH_SIZE = 30;

export function syncBatchSize(): number {
  const n = Number(process.env.SCAN_MAX_FILES ?? "150");
  if (!Number.isFinite(n) || n <= 0) return 150;
  return Math.floor(n);
}
