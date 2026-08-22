import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { ScanJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  runScanJob,
  reconcileOcrStatus,
  sweepStuckInFlightFiles,
  countPendingCloudFilesForUser,
  hasActiveScanJobForUser,
} from "./sync.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const AUTO_SCAN = (process.env.AUTO_SCAN_ENABLED ?? "false") === "true";

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

export async function maybeAutoScan(): Promise<void> {
  if (!AUTO_SCAN) return;

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });

  const maxFiles = Number(process.env.SCAN_MAX_FILES ?? "50");
  const batch =
    Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 50;

  for (const user of users) {
    try {
      if (await hasActiveScanJobForUser(user.id)) continue;

      const pending = await countPendingCloudFilesForUser(user.id);
      if (pending <= 0) continue;

      const job = await prisma.scanJob.create({
        data: {
          status: ScanJobStatus.PENDING,
          triggeredById: user.id,
          jobType: "ingest_all",
          selectedPaths: JSON.stringify({
            mode: "all",
            rootPath: "/",
            limit: batch,
          }),
        },
      });
      await enqueueScanJob(job.id);
      console.log(
        `[discovery] auto-scan for ${user.email}: ~${pending} pending → batch ${batch} → ${job.id}`
      );
    } catch (err) {
      console.error(`[discovery] user ${user.id}:`, err);
    }
  }
}

const intervals: NodeJS.Timeout[] = [];

export function startBackgroundTasks(): void {
  const pollInterval = Number(process.env.SYNC_POLL_INTERVAL_MS ?? 900_000);

  // Resolve OCR_PENDING ASAP after restart / deploy
  void reconcileOcrStatus()
    .then(({ done, timedOut }) => {
      if (done || timedOut) {
        console.log(`[reconcile:startup] done=${done} timedOut=${timedOut}`);
      }
    })
    .catch((err) => console.error("[reconcile:startup] error:", err));

  intervals.push(
    setInterval(async () => {
      try {
        const { done, timedOut } = await reconcileOcrStatus();
        if (done || timedOut) {
          console.log(`[reconcile] done=${done} timedOut=${timedOut}`);
        }
        await maybeAutoScan();
      } catch (err) {
        console.error("[discovery] error:", err);
      }
    }, pollInterval)
  );

  intervals.push(
    setInterval(async () => {
      try {
        await reconcileOcrStatus();
        const swept = await sweepStuckInFlightFiles();
        if (swept > 0) {
          console.log(`[sweep] marked ${swept} stuck QUEUED/DOWNLOADING as FAILED`);
        }
      } catch (err) {
        console.error("[reconcile] error:", err);
      }
    }, 60_000)
  );
}

export async function shutdown(): Promise<void> {
  for (const id of intervals) clearInterval(id);
  await worker?.close();
  await scanQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}
