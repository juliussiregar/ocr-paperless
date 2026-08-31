import { ScanJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { enqueueScanJob } from "./scan-queues.js";
import { scanMaxFiles } from "./sync-job-helpers.js";
import { hasActiveScanJobForUser } from "./sync.js";
import { ingestMaxRetries } from "./sync-fail.js";

const SETTING_AUTO_RETRY_ENABLED = "auto_retry_enabled";
const SETTING_AUTO_RETRY_LAST_RUN_AT = "auto_retry_last_run_at";
const SETTING_AUTO_RETRY_INTERVAL_MINUTES = "auto_retry_interval_minutes";
const SETTING_AUTO_RETRY_BATCH_SIZE = "auto_retry_batch_size";

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function isAutoRetryEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_AUTO_RETRY_ENABLED)) === "true";
}

async function retryIntervalMs(): Promise<number> {
  const raw = Number((await getSetting(SETTING_AUTO_RETRY_INTERVAL_MINUTES)) ?? "120");
  const minutes = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
  return minutes * 60_000;
}

async function retryBatchSize(): Promise<number> {
  const raw = Number((await getSetting(SETTING_AUTO_RETRY_BATCH_SIZE)) ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  const env = scanMaxFiles();
  return env > 0 ? env : 30;
}

/** Phase 3: retry FAILED paths on separate schedule from delta auto-scan. */
export async function maybeAutoRetryFailed(): Promise<void> {
  if (!(await isAutoRetryEnabled())) return;

  const intervalMs = await retryIntervalMs();
  const lastRaw = await getSetting(SETTING_AUTO_RETRY_LAST_RUN_AT);
  if (lastRaw) {
    const lastMs = Date.parse(lastRaw);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < intervalMs) return;
  }

  await setSetting(SETTING_AUTO_RETRY_LAST_RUN_AT, new Date().toISOString());

  const batch = await retryBatchSize();
  const maxRetries = ingestMaxRetries();
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  let enqueued = 0;

  for (const user of users) {
    if (await hasActiveScanJobForUser(user.id)) continue;

    const failed = await prisma.syncFile.findMany({
      where: {
        userId: user.id,
        syncStatus: "FAILED",
        ingestRetryCount: { lt: maxRetries },
      },
      select: { remotePath: true },
      take: batch,
      orderBy: { updatedAt: "asc" },
    });
    if (failed.length === 0) continue;

    const paths = failed.map((f) => f.remotePath);
    const job = await prisma.scanJob.create({
      data: {
        status: ScanJobStatus.PENDING,
        triggeredById: user.id,
        jobType: "ingest_paths",
        selectedPaths: JSON.stringify({
          mode: "paths",
          paths,
          source: "auto_retry",
        }),
      },
    });

    await enqueueScanJob(job.id);
    enqueued++;
    console.log(`[auto-retry] ${user.email} ${paths.length} failed → ${job.id}`);
    break;
  }

  if (enqueued === 0) {
    console.log("[auto-retry] tick: nothing to retry");
  }
}
