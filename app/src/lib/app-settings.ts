import { prisma } from "@/lib/prisma";
import {
  AUTO_RETRY_BATCH_SIZE,
  AUTO_RETRY_INTERVAL_MINUTES,
  SYNC_ROOT_PATH,
  syncBatchSize,
} from "@/lib/sync-defaults";

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
  autoScanIntervalMinutes: number;
  autoScanLastRunAt: string | null;
};

/** Write internal defaults used by worker (hidden from Admin UI). */
export async function applySyncOperationalDefaults(): Promise<void> {
  const batch = syncBatchSize();
  const ops: Array<{ key: string; value: string }> = [
    { key: SETTING_AUTO_SCAN_READY, value: "true" },
    { key: SETTING_AUTO_SCAN_BATCH_SIZE, value: String(batch) },
    { key: SETTING_AUTO_SCAN_ROOT_PATH, value: SYNC_ROOT_PATH },
    { key: SETTING_AUTO_SCAN_SUBTREES, value: "" },
    { key: SETTING_AUTO_RETRY_ENABLED, value: "true" },
    {
      key: SETTING_AUTO_RETRY_INTERVAL_MINUTES,
      value: String(AUTO_RETRY_INTERVAL_MINUTES),
    },
    {
      key: SETTING_AUTO_RETRY_BATCH_SIZE,
      value: String(AUTO_RETRY_BATCH_SIZE),
    },
  ];
  for (const { key, value } of ops) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

export async function getAutoScanSettings(): Promise<AutoScanSettings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          SETTING_AUTO_SCAN_ENABLED,
          SETTING_AUTO_SCAN_INTERVAL_MINUTES,
          SETTING_AUTO_SCAN_LAST_RUN_AT,
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

  return {
    autoScanEnabled: map.get(SETTING_AUTO_SCAN_ENABLED) === "true",
    autoScanIntervalMinutes: interval,
    autoScanLastRunAt: map.get(SETTING_AUTO_SCAN_LAST_RUN_AT) ?? null,
  };
}

export async function updateAutoScanSettings(input: {
  autoScanEnabled?: boolean;
  autoScanIntervalMinutes?: number;
}): Promise<AutoScanSettings> {
  if (input.autoScanEnabled === false) {
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_RETRY_ENABLED },
      create: { key: SETTING_AUTO_RETRY_ENABLED, value: "false" },
      update: { value: "false" },
    });
  }

  if (input.autoScanEnabled === true) {
    await applySyncOperationalDefaults();
  }

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

  if (input.autoScanIntervalMinutes != null) {
    const m = Math.max(5, Math.floor(input.autoScanIntervalMinutes));
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_SCAN_INTERVAL_MINUTES },
      create: { key: SETTING_AUTO_SCAN_INTERVAL_MINUTES, value: String(m) },
      update: { value: String(m) },
    });
  }

  return getAutoScanSettings();
}

/** Legacy helper: toggle only enabled flag. */
export async function setAutoScanEnabled(enabled: boolean): Promise<void> {
  await updateAutoScanSettings({ autoScanEnabled: enabled });
}
