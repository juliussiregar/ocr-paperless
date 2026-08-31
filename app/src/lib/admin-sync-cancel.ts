import { ScanJobStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { getRedis } from "@/lib/queue";
import { abandonInFlightSyncFiles } from "@/lib/scan-cleanup";

const INGEST_JOB_TYPES = new Set(["ingest_paths"]);

export type CancelAllSyncResult = {
  cancelledJobIds: string[];
  abandonedFiles: number;
  locksReleased: number;
  queueJobsRemoved: number;
};

async function removeScanJobFromQueues(
  scanJobId: string,
  jobType: string | null
): Promise<number> {
  let removed = 0;
  const targets =
    jobType && INGEST_JOB_TYPES.has(jobType)
      ? [{ name: "scan-ingest", prefix: "ingest" }]
      : jobType
        ? [{ name: "scan-discover", prefix: "discover" }]
        : [
            { name: "scan-discover", prefix: "discover" },
            { name: "scan-ingest", prefix: "ingest" },
          ];

  for (const { name, prefix } of targets) {
    const queue = new Queue(name, { connection: getRedis() });
    try {
      const bullJob = await queue.getJob(`${prefix}-${scanJobId}`);
      if (bullJob) {
        await bullJob.remove();
        removed += 1;
      }
    } finally {
      await queue.close();
    }
  }
  return removed;
}

/** Cancel all pending/running scan jobs, clear queues, release locks. */
export async function cancelAllRunningSyncJobs(
  adminUserId: string,
  reason: string
): Promise<CancelAllSyncResult> {
  const activeJobs = await prisma.scanJob.findMany({
    where: {
      status: {
        in: [
          ScanJobStatus.PENDING,
          ScanJobStatus.RUNNING,
          ScanJobStatus.PAUSED,
        ],
      },
    },
    select: { id: true, triggeredById: true, jobType: true },
  });

  if (activeJobs.length === 0) {
    const lockKeys = await getRedis().keys("scan:lock:*");
    let locksReleased = 0;
    if (lockKeys.length > 0) {
      locksReleased = await getRedis().del(...lockKeys);
    }
    return {
      cancelledJobIds: [],
      abandonedFiles: 0,
      locksReleased,
      queueJobsRemoved: 0,
    };
  }

  const jobIds = activeJobs.map((j) => j.id);

  await prisma.scanJob.updateMany({
    where: { id: { in: jobIds } },
    data: {
      status: ScanJobStatus.CANCELLED,
      completedAt: new Date(),
      errorMessage: reason,
      phase: "done",
      currentFile: null,
    },
  });

  let queueJobsRemoved = 0;
  for (const job of activeJobs) {
    queueJobsRemoved += await removeScanJobFromQueues(job.id, job.jobType);
  }

  let abandonedFiles = 0;
  const userIds = new Set(
    activeJobs.map((j) => j.triggeredById).filter((id): id is string => !!id)
  );
  for (const userId of userIds) {
    abandonedFiles += await abandonInFlightSyncFiles(userId, reason);
  }

  const lockKeys = await getRedis().keys("scan:lock:*");
  const locksReleased =
    lockKeys.length > 0 ? await getRedis().del(...lockKeys) : 0;

  await writeAudit("admin.scan.cancel_all", adminUserId, {
    cancelledCount: jobIds.length,
    abandonedFiles,
    locksReleased,
    queueJobsRemoved,
    reason,
  });

  return {
    cancelledJobIds: jobIds,
    abandonedFiles,
    locksReleased,
    queueJobsRemoved,
  };
}
