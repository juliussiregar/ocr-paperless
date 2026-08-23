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

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const SETTING_AUTO_SCAN_ENABLED = "auto_scan_enabled";
const SETTING_AUTO_SCAN_INTERVAL_MINUTES = "auto_scan_interval_minutes";
const SETTING_AUTO_SCAN_LAST_RUN_AT = "auto_scan_last_run_at";

export const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export const scanQueue = new Queue("scan-jobs", { connection });

let worker: Worker | null = null;

export function startScanWorker(): Worker {
  worker = new Worker(
    "scan-jobs",
    async (job) => {
      const jobId = job.data.jobId as string;
      await runScanJob(jobId);
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Scan job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`Scan job ${job.id} completed`);
  });

  return worker;
}

export async function enqueueScanJob(jobId: string): Promise<void> {
  await scanQueue.add(
    "scan",
    { jobId },
    {
      jobId: `scan-${jobId}`,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );
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
  const maxFiles = Number(process.env.SCAN_MAX_FILES ?? "50");
  return Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 50;
}

/** True if admin toggle on, or ops force via AUTO_SCAN_ENABLED=true. */
async function isAutoScanEnabled(): Promise<boolean> {
  if ((process.env.AUTO_SCAN_ENABLED ?? "false") === "true") return true;
  return (await getSetting(SETTING_AUTO_SCAN_ENABLED)) === "true";
}

async function autoScanIntervalMs(): Promise<number> {
  const raw = Number(
    (await getSetting(SETTING_AUTO_SCAN_INTERVAL_MINUTES)) ?? "60"
  );
  const minutes =
    Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60;
  return minutes * 60_000;
}

/**
 * Enqueue newest-batch ingest jobs for each user favorite folder.
 * Does not walk the whole cloud (no pre-count PROPFIND).
 * Round-robins favorites via lastOpenedAt (oldest first, bump after enqueue).
 */
export async function maybeAutoScan(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });

  const batch = autoScanBatchSize();
  let enqueued = 0;

  for (const user of users) {
    try {
      if (await hasActiveScanJobForUser(user.id)) continue;

      const creds = await getUserCloudCredentials(user.id);
      if (!creds) continue;

      // Oldest lastOpenedAt first so we rotate across favorites each hour.
      const favorites = await prisma.cloudFavorite.findMany({
        where: { userId: user.id },
        select: { id: true, path: true },
        orderBy: { lastOpenedAt: "asc" },
      });
      if (favorites.length === 0) continue;

      if (await hasActiveScanJobForUser(user.id)) continue;

      const fav = favorites[0]!;
      const rootPath =
        !fav.path || fav.path === "/"
          ? "/"
          : fav.path.startsWith("/")
            ? fav.path.replace(/\/$/, "") || "/"
            : `/${fav.path}`.replace(/\/$/, "") || "/";

      const job = await prisma.scanJob.create({
        data: {
          status: ScanJobStatus.PENDING,
          triggeredById: user.id,
          jobType: "ingest_newest",
          selectedPaths: JSON.stringify({
            mode: "newest",
            rootPath,
            limit: batch,
          }),
        },
      });

      try {
        await enqueueScanJob(job.id);
      } catch (err) {
        await prisma.scanJob.update({
          where: { id: job.id },
          data: {
            status: ScanJobStatus.FAILED,
            completedAt: new Date(),
            errorMessage: `Gagal enqueue: ${
              err instanceof Error ? err.message : "unknown"
            }`,
            phase: "done",
          },
        });
        throw err;
      }

      // Bump so this favorite rotates to the end next tick.
      await prisma.cloudFavorite.update({
        where: { id: fav.id },
        data: { lastOpenedAt: new Date() },
      });

      enqueued++;
      console.log(
        `[auto-scan] ${user.email} favorite ${rootPath} → batch ${batch} → ${job.id}`
      );
    } catch (err) {
      console.error(`[auto-scan] user ${user.id}:`, err);
    }
  }

  if (enqueued === 0) {
    console.log(
      "[auto-scan] tick: no jobs enqueued (no favorites / busy / no creds)"
    );
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

  // OCR reconcile on SYNC_POLL_INTERVAL (no auto-scan here)
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

  // Auto-scan schedule: check every 60s; run when enabled + interval elapsed
  intervals.push(
    setInterval(async () => {
      try {
        await tickAutoScanSchedule();
      } catch (err) {
        console.error("[auto-scan] schedule error:", err);
      }
    }, 60_000)
  );

  // OCR reconcile frequently so UI status catches up soon after Paperless finishes
  const ocrReconcileMs = Number(process.env.OCR_RECONCILE_INTERVAL_MS ?? 15_000);
  intervals.push(
    setInterval(async () => {
      try {
        await reconcileOcrStatus();
        const swept = await sweepStuckInFlightFiles();
        if (swept > 0) {
          console.log(`[sweep] marked ${swept} stuck QUEUED/DOWNLOADING as FAILED`);
        }
        // Embed separately so OCR status updates stay snappy
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
  await worker?.close();
  await scanQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}
