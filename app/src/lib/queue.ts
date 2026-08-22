import { Redis } from "ioredis";
import { Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let connection: Redis | null = null;
let scanQueue: Queue | null = null;

export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getScanQueue(): Queue {
  if (!scanQueue) {
    scanQueue = new Queue("scan-jobs", { connection: getRedis() });
  }
  return scanQueue;
}

export async function enqueueScanJob(jobId: string): Promise<void> {
  const queue = getScanQueue();
  await queue.add(
    "scan",
    { jobId },
    {
      jobId: `scan-${jobId}`,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );
}
