import { Redis } from "ioredis";
import { Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let connection: Redis | null = null;

export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

function getDiscoverQueue(): Queue {
  return new Queue("scan-discover", { connection: getRedis() });
}

function getIngestQueue(): Queue {
  return new Queue("scan-ingest", { connection: getRedis() });
}

export async function enqueueScanJob(
  jobId: string,
  jobType?: string
): Promise<void> {
  const isIngest = jobType === "ingest_paths";
  const queue = isIngest ? getIngestQueue() : getDiscoverQueue();
  const prefix = isIngest ? "ingest" : "discover";
  await queue.add(
    prefix,
    { jobId },
    {
      jobId: `${prefix}-${jobId}`,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );
}
