import { prisma } from "@/lib/prisma";

export const SETTING_AUTO_SCAN_ENABLED = "auto_scan_enabled";
export const SETTING_AUTO_SCAN_INTERVAL_MINUTES = "auto_scan_interval_minutes";
export const SETTING_AUTO_SCAN_LAST_RUN_AT = "auto_scan_last_run_at";

export type AutoScanSettings = {
  autoScanEnabled: boolean;
  autoScanIntervalMinutes: number;
  autoScanLastRunAt: string | null;
  /** Env AUTO_SCAN_ENABLED=true forces worker on regardless of toggle. */
  envForceEnabled: boolean;
};

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
    envForceEnabled: (process.env.AUTO_SCAN_ENABLED ?? "false") === "true",
  };
}

export async function setAutoScanEnabled(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTING_AUTO_SCAN_ENABLED },
    create: { key: SETTING_AUTO_SCAN_ENABLED, value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
  await prisma.appSetting.upsert({
    where: { key: SETTING_AUTO_SCAN_INTERVAL_MINUTES },
    create: { key: SETTING_AUTO_SCAN_INTERVAL_MINUTES, value: "60" },
    update: {},
  });
}
