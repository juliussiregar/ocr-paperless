import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "./db.js";
import { runScanJob } from "./sync.js";
import { withUserScanLock } from "./user-lock.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export const discoverQueue = new Queue("scan-discover", { connection });
export const ingestQueue = new Queue("scan-ingest", { connection });

const INGEST_JOB_TYPES = new Set(["ingest_paths"]);

let discoverWorker: Worker | null = null;
let ingestWorker: Worker | null = null;

function discoverConcurrency(): number {
  const n = Number(process.env.SCAN_DISCOVER_CONCURRENCY ?? "4");
  if (!Number.isFinite(n)) return 4;
  return Math.min(8, Math.max(1, Math.floor(n)));
}

function ingestConcurrency(): number {
  const n = Number(process.env.SCAN_INGEST_CONCURRENCY ?? "4");
  if (!Number.isFinite(n)) return 4;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

export async function enqueueDiscoverJob(jobId: string): Promise<void> {
  await discoverQueue.add(
    "discover",
    { jobId },
    {
      jobId: `discover-${jobId}`,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );
}

export async function enqueueIngestJob(jobId: string): Promise<void> {
  await ingestQueue.add(
    "ingest",
    { jobId },
    {
      jobId: `ingest-${jobId}`,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );
}

/** Route job to discover or ingest queue based on jobType. */
export async function enqueueScanJob(jobId: string): Promise<void> {
  const job = await prisma.scanJob.findUnique({
    where: { id: jobId },
    select: { jobType: true },
  });
  if (job && INGEST_JOB_TYPES.has(job.jobType)) {
    await enqueueIngestJob(jobId);
    return;
  }
  await enqueueDiscoverJob(jobId);
}

export function startScanWorkers(): { discoverWorker: Worker; ingestWorker: Worker } {
  discoverWorker = new Worker(
    "scan-discover",
    async (job) => {
      const jobId = job.data.jobId as string;
      await runScanJob(jobId);
    },
    { connection, concurrency: discoverConcurrency() }
  );

  ingestWorker = new Worker(
    "scan-ingest",
    async (job) => {
      const jobId = job.data.jobId as string;
      const pgJob = await prisma.scanJob.findUnique({
        where: { id: jobId },
        select: { triggeredById: true, jobType: true },
      });
      if (!pgJob?.triggeredById || pgJob.jobType !== "ingest_paths") {
        await runScanJob(jobId);
        return;
      }
      const userId = pgJob.triggeredById;
      const locked = await withUserScanLock(userId, () => runScanJob(jobId));
      if (!locked.ok) {
        console.warn(`[ingest] user ${userId} busy, retry job ${jobId} in 45s`);
        await ingestQueue.add(
          "ingest",
          { jobId },
          {
            jobId: `ingest-retry-${jobId}-${Date.now()}`,
            delay: 45_000,
            removeOnComplete: 100,
            removeOnFail: 50,
          }
        );
      }
    },
    { connection, concurrency: ingestConcurrency() }
  );

  discoverWorker.on("failed", (job, err) => {
    console.error(`Discover job ${job?.id} failed:`, err.message);
  });

  ingestWorker.on("failed", (job, err) => {
    console.error(`Ingest job ${job?.id} failed:`, err.message);
  });

  return { discoverWorker, ingestWorker };
}

export async function closeScanQueues(): Promise<void> {
  await discoverWorker?.close();
  await ingestWorker?.close();
  await discoverQueue.close();
  await ingestQueue.close();
}
