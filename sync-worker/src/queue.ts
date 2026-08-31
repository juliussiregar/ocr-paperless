import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { ScanJobStatus } from "@prisma/client";
import { prisma, getUserCloudCredentials } from "./db.js";
import {
  runScanJob,
  reconcileOcrStatus,
  sweepStuckInFlightFiles,
  hasActiveScanJobForUser,
} from "./sync.js";
import { backfillDocumentEmbeddings } from "./embeddings.js";
import {
  enqueueScanJob,
  startScanWorkers,
  closeScanQueues,
  connection,
} from "./scan-queues.js";
import { maybeAutoRetryFailed } from "./retry-failed.js";
import { userInWorkerShard } from "./worker-shard.js";

const SETTING_AUTO_SCAN_ENABLED = "auto_scan_enabled";
const SETTING_AUTO_SCAN_READY = "auto_scan_ready";
const SETTING_AUTO_SCAN_INTERVAL_MINUTES = "auto_scan_interval_minutes";
const SETTING_AUTO_SCAN_BATCH_SIZE = "auto_scan_batch_size";
const SETTING_AUTO_SCAN_ROOT_PATH = "auto_scan_root_path";
const SETTING_AUTO_SCAN_LAST_RUN_AT = "auto_scan_last_run_at";
const SETTING_AUTO_SCAN_SUBTREES = "auto_scan_subtrees";
const SETTING_AUTO_SCAN_SUBTREE_INDEX = "auto_scan_subtree_index";
const SETTING_WEEKLY_RECONCILE_LAST_RUN_AT = "weekly_reconcile_last_run_at";

export const scanQueue = new Queue("scan-discover", { connection });

let workers: ReturnType<typeof startScanWorkers> | null = null;

export function startScanWorker(): Worker {
  workers = startScanWorkers();
  return workers.discoverWorker;
}

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

function autoScanBatchSize(): number {
  const fromEnv = Number(process.env.SCAN_MAX_FILES ?? "100");
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : 100;
}

async function autoScanBatchFromSettings(): Promise<number> {
  const raw = Number((await getSetting(SETTING_AUTO_SCAN_BATCH_SIZE)) ?? "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return autoScanBatchSize();
}

async function autoScanRootPath(): Promise<string> {
  const raw = (await getSetting(SETTING_AUTO_SCAN_ROOT_PATH))?.trim();
  if (!raw || raw === "/") return "/";
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  return p.replace(/\/$/, "") || "/";
}

/** Phase 4: rotate subtrees JSON array in settings. */
async function pickAutoScanRootPath(): Promise<string> {
  const base = await autoScanRootPath();
  const raw = await getSetting(SETTING_AUTO_SCAN_SUBTREES);
  if (!raw?.trim()) return base;
  try {
    const trees = JSON.parse(raw) as unknown;
    if (!Array.isArray(trees) || trees.length === 0) return base;
    const paths = trees
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => (t.startsWith("/") ? t.replace(/\/$/, "") || "/" : `/${t}`));
    if (paths.length === 0) return base;
    const idxRaw = Number((await getSetting(SETTING_AUTO_SCAN_SUBTREE_INDEX)) ?? "0");
    const idx =
      Number.isFinite(idxRaw) ? Math.abs(Math.floor(idxRaw)) % paths.length : 0;
    const picked = paths[idx] ?? base;
    await setSetting(
      SETTING_AUTO_SCAN_SUBTREE_INDEX,
      String((idx + 1) % paths.length)
    );
    return picked;
  } catch {
    return base;
  }
}

async function isAutoScanReady(): Promise<boolean> {
  return (await getSetting(SETTING_AUTO_SCAN_READY)) === "true";
}

async function isAutoScanEnabled(): Promise<boolean> {
  const envForce = (process.env.AUTO_SCAN_ENABLED ?? "false") === "true";
  const toggle = (await getSetting(SETTING_AUTO_SCAN_ENABLED)) === "true";
  if (!envForce && !toggle) return false;
  if (!envForce && !(await isAutoScanReady())) return false;
  return true;
}

async function autoScanIntervalMs(): Promise<number> {
  const raw = Number(
    (await getSetting(SETTING_AUTO_SCAN_INTERVAL_MINUTES)) ?? "60"
  );
  const minutes = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60;
  return minutes * 60_000;
}

export async function maybeAutoScan(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, lastDiscoveryAt: true },
    orderBy: { lastDiscoveryAt: "asc" },
  });

  const batch = await autoScanBatchFromSettings();
  const rootPath = await pickAutoScanRootPath();
  let enqueued = 0;

  for (const user of users) {
    if (!userInWorkerShard(user.id)) continue;
    try {
      if (await hasActiveScanJobForUser(user.id)) continue;

      const creds = await getUserCloudCredentials(user.id);
      if (!creds) continue;

      const job = await prisma.scanJob.create({
        data: {
          status: ScanJobStatus.PENDING,
          triggeredById: user.id,
          jobType: "delta_sync",
          selectedPaths: JSON.stringify({
            rootPath,
            limit: batch,
          }),
        },
      });

      await enqueueScanJob(job.id);

      enqueued++;
      console.log(
        `[auto-scan] ${user.email} delta ${rootPath} batch=${batch} → ${job.id}`
      );
      break;
    } catch (err) {
      console.error(`[auto-scan] user ${user.id}:`, err);
    }
  }

  if (enqueued === 0) {
    console.log("[auto-scan] tick: no jobs enqueued (busy / no creds / shard)");
  }
}

/** Phase 4: weekly full reconcile (no ingest). */
export async function maybeWeeklyReconcile(): Promise<void> {
  if (!(await isAutoScanReady())) return;

  const lastRaw = await getSetting(SETTING_WEEKLY_RECONCILE_LAST_RUN_AT);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (lastRaw) {
    const lastMs = Date.parse(lastRaw);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < weekMs) return;
  }

  await setSetting(
    SETTING_WEEKLY_RECONCILE_LAST_RUN_AT,
    new Date().toISOString()
  );

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { lastDiscoveryAt: "asc" },
  });

  for (const user of users) {
    if (!userInWorkerShard(user.id)) continue;
    if (await hasActiveScanJobForUser(user.id)) continue;
    const creds = await getUserCloudCredentials(user.id);
    if (!creds) continue;

    const rootPath = await pickAutoScanRootPath();
    const job = await prisma.scanJob.create({
      data: {
        status: ScanJobStatus.PENDING,
        triggeredById: user.id,
        jobType: "reconcile_only",
        selectedPaths: JSON.stringify({
          rootPath,
          limit: 0,
          reconcileOnly: true,
        }),
      },
    });
    await enqueueScanJob(job.id);
    console.log(`[weekly-reconcile] ${user.email} ${rootPath} → ${job.id}`);
    break;
  }
}

async function tickAutoScanSchedule(): Promise<void> {
  if (!(await isAutoScanEnabled())) return;

  const intervalMs = await autoScanIntervalMs();
  const lastRaw = await getSetting(SETTING_AUTO_SCAN_LAST_RUN_AT);
  if (lastRaw) {
    const lastMs = Date.parse(lastRaw);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < intervalMs) {
      return;
    }
  }

  await setSetting(SETTING_AUTO_SCAN_LAST_RUN_AT, new Date().toISOString());
  console.log(
    `[auto-scan] due (interval ${Math.round(intervalMs / 60_000)}m) → running`
  );
  await maybeAutoScan();
}

const intervals: NodeJS.Timeout[] = [];

export function startBackgroundTasks(): void {
  const pollInterval = Number(process.env.SYNC_POLL_INTERVAL_MS ?? 900_000);

  void reconcileOcrStatus()
    .then(({ done, timedOut }) => {
      if (done || timedOut) {
        console.log(`[reconcile:startup] done=${done} timedOut=${timedOut}`);
      }
    })
    .catch((err) => console.error("[reconcile:startup] error:", err));

  void backfillDocumentEmbeddings()
    .then((n) => {
      if (n > 0) console.log(`[embed:startup] backfilled ${n}`);
    })
    .catch((err) => console.error("[embed:startup] error:", err));

  intervals.push(
    setInterval(async () => {
      try {
        const { done, timedOut } = await reconcileOcrStatus();
        if (done || timedOut) {
          console.log(`[reconcile] done=${done} timedOut=${timedOut}`);
        }
      } catch (err) {
        console.error("[reconcile] error:", err);
      }
    }, pollInterval)
  );

  intervals.push(
    setInterval(async () => {
      try {
        await tickAutoScanSchedule();
      } catch (err) {
        console.error("[auto-scan] schedule error:", err);
      }
    }, 60_000)
  );

  intervals.push(
    setInterval(async () => {
      try {
        await maybeAutoRetryFailed();
      } catch (err) {
        console.error("[auto-retry] schedule error:", err);
      }
    }, 60_000)
  );

  intervals.push(
    setInterval(async () => {
      try {
        await maybeWeeklyReconcile();
      } catch (err) {
        console.error("[weekly-reconcile] error:", err);
      }
    }, 60 * 60 * 1000)
  );

  const ocrReconcileMs = Number(process.env.OCR_RECONCILE_INTERVAL_MS ?? 15_000);
  intervals.push(
    setInterval(async () => {
      try {
        await reconcileOcrStatus();
        const swept = await sweepStuckInFlightFiles();
        if (swept > 0) {
          console.log(`[sweep] marked ${swept} stuck QUEUED/DOWNLOADING as FAILED`);
        }
        const backfilled = await backfillDocumentEmbeddings();
        if (backfilled > 0) {
          console.log(`[embed] backfilled ${backfilled} documents`);
        }
      } catch (err) {
        console.error("[reconcile] error:", err);
      }
    }, Math.max(5_000, ocrReconcileMs))
  );
}

export async function shutdown(): Promise<void> {
  for (const id of intervals) clearInterval(id);
  await closeScanQueues();
  await scanQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}
