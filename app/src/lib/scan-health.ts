import { ScanJobStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/queue";

export type QueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
};

export type StuckScanJob = {
  id: string;
  jobType: string;
  phase: string | null;
  currentFile: string | null;
  startedAt: string;
  userEmail: string | null;
};

export type ScanHealth = {
  queues: {
    discover: QueueCounts;
    ingest: QueueCounts;
  };
  redis: {
    usedMemoryHuman: string;
    maxMemoryHuman: string;
    usedMemoryBytes: number;
  };
  stuckJobs: StuckScanJob[];
  userLocks: string[];
  ingestMaxRetries: number;
  failedExhaustedTotal: number;
  pgJobCounts: Array<{ status: string; count: number }>;
  throughput: {
    scanMaxFiles: number;
    discoverConcurrency: number;
    ingestConcurrency: number;
    webdavDiscoveryConcurrency: number;
    webdavDownloadConcurrency: number;
    ocrReconcileIntervalMs: number;
    embedBackfillBatch: number;
    postSyncWarmEnabled: boolean;
    postSyncWarmMaxDirs: number;
  };
  pipeline: {
    ocrPending: number;
    downloading: number;
    queued: number;
    ocrDone: number;
  };
};

export function ingestMaxRetries(): number {
  const n = Number(process.env.INGEST_MAX_RETRY_COUNT ?? "5");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function stuckJobMinutes(): number {
  const n = Number(process.env.SCAN_STUCK_JOB_MINUTES ?? "45");
  return Number.isFinite(n) && n > 5 ? Math.floor(n) : 45;
}

async function getQueueCounts(name: string): Promise<QueueCounts> {
  const queue = new Queue(name, { connection: getRedis() });
  try {
    const c = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed"
    );
    return {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
      completed: c.completed ?? 0,
    };
  } finally {
    await queue.close();
  }
}

function parseRedisInfo(info: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of info.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    map[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return map;
}

function numEnv(key: string, fallback: number): number {
  const n = Number(process.env[key] ?? String(fallback));
  return Number.isFinite(n) ? n : fallback;
}

export async function getScanHealth(): Promise<ScanHealth> {
  const maxRetries = ingestMaxRetries();
  const stuckCutoff = new Date(Date.now() - stuckJobMinutes() * 60 * 1000);

  const [
    discover,
    ingest,
    redisInfo,
    lockKeys,
    stuckRows,
    failedExhaustedTotal,
    pgJobCounts,
    ocrPending,
    downloading,
    queued,
    ocrDone,
  ] = await Promise.all([
    getQueueCounts("scan-discover"),
    getQueueCounts("scan-ingest"),
    getRedis().info("memory"),
    getRedis().keys("scan:lock:*"),
    prisma.scanJob.findMany({
      where: {
        status: ScanJobStatus.RUNNING,
        startedAt: { lt: stuckCutoff },
      },
      select: {
        id: true,
        jobType: true,
        phase: true,
        currentFile: true,
        startedAt: true,
        triggeredBy: { select: { email: true } },
      },
      orderBy: { startedAt: "asc" },
      take: 25,
    }),
    prisma.syncFile.count({
      where: {
        syncStatus: "FAILED",
        ingestRetryCount: { gte: maxRetries },
      },
    }),
    prisma.scanJob.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: {
        status: {
          in: [
            ScanJobStatus.PENDING,
            ScanJobStatus.RUNNING,
            ScanJobStatus.PAUSED,
            ScanJobStatus.FAILED,
          ],
        },
      },
    }),
    prisma.syncFile.count({ where: { syncStatus: "OCR_PENDING" } }),
    prisma.syncFile.count({ where: { syncStatus: "DOWNLOADING" } }),
    prisma.syncFile.count({ where: { syncStatus: "QUEUED" } }),
    prisma.syncFile.count({ where: { syncStatus: "OCR_DONE" } }),
  ]);

  const mem = parseRedisInfo(redisInfo);

  return {
    queues: { discover, ingest },
    redis: {
      usedMemoryHuman: mem.used_memory_human ?? "-",
      maxMemoryHuman: mem.maxmemory_human ?? "-",
      usedMemoryBytes: Number(mem.used_memory ?? 0),
    },
    stuckJobs: stuckRows.map((row) => ({
      id: row.id,
      jobType: row.jobType,
      phase: row.phase,
      currentFile: row.currentFile,
      startedAt: row.startedAt?.toISOString() ?? "",
      userEmail: row.triggeredBy?.email ?? null,
    })),
    userLocks: lockKeys.map((k) => k.replace(/^scan:lock:/, "")),
    ingestMaxRetries: maxRetries,
    failedExhaustedTotal,
    pgJobCounts: pgJobCounts.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
    throughput: {
      scanMaxFiles: numEnv("SCAN_MAX_FILES", 750),
      discoverConcurrency: numEnv("SCAN_DISCOVER_CONCURRENCY", 8),
      ingestConcurrency: numEnv("SCAN_INGEST_CONCURRENCY", 8),
      webdavDiscoveryConcurrency: numEnv("WEBDAV_DISCOVERY_CONCURRENCY", 16),
      webdavDownloadConcurrency: numEnv("WEBDAV_DOWNLOAD_CONCURRENCY", 10),
      ocrReconcileIntervalMs: numEnv("OCR_RECONCILE_INTERVAL_MS", 5000),
      embedBackfillBatch: numEnv("EMBED_BACKFILL_BATCH", 35),
      postSyncWarmEnabled:
        (process.env.POST_SYNC_WARM_ENABLED ?? "true") !== "false",
      postSyncWarmMaxDirs: numEnv("POST_SYNC_WARM_MAX_DIRS", 16),
    },
    pipeline: {
      ocrPending,
      downloading,
      queued,
      ocrDone,
    },
  };
}

export async function releaseUserScanLock(userId: string): Promise<boolean> {
  const deleted = await getRedis().del(`scan:lock:${userId}`);
  return deleted > 0;
}
