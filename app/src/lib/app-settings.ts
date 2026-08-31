import { prisma } from "@/lib/prisma";

export const SETTING_AUTO_SCAN_ENABLED = "auto_scan_enabled";
export const SETTING_AUTO_SCAN_READY = "auto_scan_ready";
export const SETTING_AUTO_SCAN_INTERVAL_MINUTES = "auto_scan_interval_minutes";
export const SETTING_AUTO_SCAN_BATCH_SIZE = "auto_scan_batch_size";
export const SETTING_AUTO_SCAN_ROOT_PATH = "auto_scan_root_path";
export const SETTING_AUTO_SCAN_LAST_RUN_AT = "auto_scan_last_run_at";
export const SETTING_AUTO_SCAN_SUBTREES = "auto_scan_subtrees";
export const SETTING_AUTO_RETRY_ENABLED = "auto_retry_enabled";
export const SETTING_AUTO_RETRY_INTERVAL_MINUTES = "auto_retry_interval_minutes";
export const SETTING_AUTO_RETRY_BATCH_SIZE = "auto_retry_batch_size";

export type AutoScanSettings = {
  autoScanEnabled: boolean;
  autoScanReady: boolean;
  autoScanIntervalMinutes: number;
  autoScanBatchSize: number;
  autoScanRootPath: string;
  autoScanSubtrees: string;
  autoRetryEnabled: boolean;
  autoRetryIntervalMinutes: number;
  autoRetryBatchSize: number;
  autoScanLastRunAt: string | null;
  envForceEnabled: boolean;
};

export async function getAutoScanSettings(): Promise<AutoScanSettings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          SETTING_AUTO_SCAN_ENABLED,
          SETTING_AUTO_SCAN_READY,
          SETTING_AUTO_SCAN_INTERVAL_MINUTES,
          SETTING_AUTO_SCAN_BATCH_SIZE,
          SETTING_AUTO_SCAN_ROOT_PATH,
          SETTING_AUTO_SCAN_LAST_RUN_AT,
          SETTING_AUTO_SCAN_SUBTREES,
          SETTING_AUTO_RETRY_ENABLED,
          SETTING_AUTO_RETRY_INTERVAL_MINUTES,
          SETTING_AUTO_RETRY_BATCH_SIZE,
        ],
      },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const intervalRaw = Number(
    map.get(SETTING_AUTO_SCAN_INTERVAL_MINUTES) ?? "60"
  );
  const interval =
    Number.isFinite(intervalRaw) && intervalRaw > 0
      ? Math.floor(intervalRaw)
      : 60;

  const batchRaw = Number(map.get(SETTING_AUTO_SCAN_BATCH_SIZE) ?? "100");
  const batch =
    Number.isFinite(batchRaw) && batchRaw > 0 ? Math.floor(batchRaw) : 100;

  const root =
    (map.get(SETTING_AUTO_SCAN_ROOT_PATH) ?? "/").trim() || "/";

  const retryIntervalRaw = Number(
    map.get(SETTING_AUTO_RETRY_INTERVAL_MINUTES) ?? "120"
  );
  const retryInterval =
    Number.isFinite(retryIntervalRaw) && retryIntervalRaw > 0
      ? Math.floor(retryIntervalRaw)
      : 120;

  const retryBatchRaw = Number(map.get(SETTING_AUTO_RETRY_BATCH_SIZE) ?? "30");
  const retryBatch =
    Number.isFinite(retryBatchRaw) && retryBatchRaw > 0
      ? Math.floor(retryBatchRaw)
      : 30;

  return {
    autoScanEnabled: map.get(SETTING_AUTO_SCAN_ENABLED) === "true",
    autoScanReady: map.get(SETTING_AUTO_SCAN_READY) === "true",
    autoScanIntervalMinutes: interval,
    autoScanBatchSize: batch,
    autoScanRootPath: root,
    autoScanSubtrees: map.get(SETTING_AUTO_SCAN_SUBTREES) ?? "",
    autoRetryEnabled: map.get(SETTING_AUTO_RETRY_ENABLED) === "true",
    autoRetryIntervalMinutes: retryInterval,
    autoRetryBatchSize: retryBatch,
    autoScanLastRunAt: map.get(SETTING_AUTO_SCAN_LAST_RUN_AT) ?? null,
    envForceEnabled: (process.env.AUTO_SCAN_ENABLED ?? "false") === "true",
  };
}

export async function updateAutoScanSettings(input: {
  autoScanEnabled?: boolean;
  autoScanReady?: boolean;
  autoScanIntervalMinutes?: number;
  autoScanBatchSize?: number;
  autoScanRootPath?: string;
  autoScanSubtrees?: string;
  autoRetryEnabled?: boolean;
  autoRetryIntervalMinutes?: number;
  autoRetryBatchSize?: number;
}): Promise<AutoScanSettings> {
  if (input.autoScanEnabled != null) {
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_ENABLED },
      create: {
        key: SETTING_AUTO_SCAN_ENABLED,
        value: input.autoScanEnabled ? "true" : "false",
      },
      update: { value: input.autoScanEnabled ? "true" : "false" },
    });
  }

  if (input.autoScanReady != null) {
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_READY },
      create: {
        key: SETTING_AUTO_SCAN_READY,
        value: input.autoScanReady ? "true" : "false",
      },
      update: { value: input.autoScanReady ? "true" : "false" },
    });
  }

  if (input.autoScanIntervalMinutes != null) {
    const m = Math.max(5, Math.floor(input.autoScanIntervalMinutes));
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_INTERVAL_MINUTES },
      create: { key: SETTING_AUTO_SCAN_INTERVAL_MINUTES, value: String(m) },
      update: { value: String(m) },
    });
  }

  if (input.autoScanBatchSize != null) {
    const b = Math.max(1, Math.floor(input.autoScanBatchSize));
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_BATCH_SIZE },
      create: { key: SETTING_AUTO_SCAN_BATCH_SIZE, value: String(b) },
      update: { value: String(b) },
    });
  }

  if (input.autoScanRootPath != null) {
    const p = input.autoScanRootPath.trim() || "/";
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_ROOT_PATH },
      create: { key: SETTING_AUTO_SCAN_ROOT_PATH, value: p },
      update: { value: p },
    });
  }

  if (input.autoScanSubtrees != null) {
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_SUBTREES },
      create: { key: SETTING_AUTO_SCAN_SUBTREES, value: input.autoScanSubtrees },
      update: { value: input.autoScanSubtrees },
    });
  }

  if (input.autoRetryEnabled != null) {
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_RETRY_ENABLED },
      create: {
        key: SETTING_AUTO_RETRY_ENABLED,
        value: input.autoRetryEnabled ? "true" : "false",
      },
      update: { value: input.autoRetryEnabled ? "true" : "false" },
    });
  }

  if (input.autoRetryIntervalMinutes != null) {
    const m = Math.max(15, Math.floor(input.autoRetryIntervalMinutes));
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_RETRY_INTERVAL_MINUTES },
      create: { key: SETTING_AUTO_RETRY_INTERVAL_MINUTES, value: String(m) },
      update: { value: String(m) },
    });
  }

  if (input.autoRetryBatchSize != null) {
    const b = Math.max(1, Math.floor(input.autoRetryBatchSize));
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_RETRY_BATCH_SIZE },
      create: { key: SETTING_AUTO_RETRY_BATCH_SIZE, value: String(b) },
      update: { value: String(b) },
    });
  }

  return getAutoScanSettings();
}

/** Legacy helper: toggle only enabled flag. */
export async function setAutoScanEnabled(enabled: boolean): Promise<void> {
  await updateAutoScanSettings({ autoScanEnabled: enabled });
}
