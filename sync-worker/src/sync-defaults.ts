/** Operational sync defaults (not exposed in Admin UI). */

export const SYNC_ROOT_PATH = "/";

export const AUTO_RETRY_INTERVAL_MINUTES = 120;
export const AUTO_RETRY_BATCH_SIZE = 30;

/** No practical cap for unlimited ingest runs. */
export const SYNC_NO_LIMIT = Number.MAX_SAFE_INTEGER;

/** 0 = unlimited single run; default 750 per batch (chained until done). */
export function syncBatchSize(): number {
  const n = Number(process.env.SCAN_MAX_FILES ?? "750");
  if (!Number.isFinite(n) || n < 0) return 750;
  return Math.floor(n);
}

export function isUnlimitedSyncBatch(): boolean {
  return syncBatchSize() === 0;
}

/** Resolve per-job ingest cap from payload limit and env SCAN_MAX_FILES. */
export function effectiveIngestLimit(explicitLimit?: number | null): number {
  const envCap = syncBatchSize();
  const explicit =
    explicitLimit != null && Number.isFinite(explicitLimit)
      ? Math.floor(explicitLimit)
      : 0;

  if (explicit > 0 && envCap > 0) return Math.min(explicit, envCap);
  if (envCap === 0) {
    return explicit > 0 ? explicit : SYNC_NO_LIMIT;
  }
  return envCap;
}

/** Value stored in delta_sync JSON payload (0 = unlimited). */
export function syncLimitForJobPayload(): number {
  return syncBatchSize();
}
