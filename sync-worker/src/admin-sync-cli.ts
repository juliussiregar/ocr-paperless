import { ScanJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  discoverQueue,
  ingestQueue,
  enqueueScanJob,
  connection,
} from "./scan-queues.js";
import { abandonInFlightSyncFiles } from "./sync-job-helpers.js";
import { hasActiveScanJobForUser } from "./sync.js";
import {
  AUTO_RETRY_BATCH_SIZE,
  AUTO_RETRY_INTERVAL_MINUTES,
  SYNC_ROOT_PATH,
  syncLimitForJobPayload,
} from "./sync-defaults.js";
import { getUserCloudCredentials } from "./db.js";

const SETTING_AUTO_SCAN_ENABLED = "auto_scan_enabled";
const SETTING_AUTO_SCAN_READY = "auto_scan_ready";
const SETTING_AUTO_SCAN_INTERVAL_MINUTES = "auto_scan_interval_minutes";
const SETTING_AUTO_SCAN_BATCH_SIZE = "auto_scan_batch_size";
const SETTING_AUTO_SCAN_ROOT_PATH = "auto_scan_root_path";
const SETTING_AUTO_SCAN_SUBTREES = "auto_scan_subtrees";
const SETTING_AUTO_RETRY_ENABLED = "auto_retry_enabled";
const SETTING_AUTO_RETRY_INTERVAL_MINUTES = "auto_retry_interval_minutes";
const SETTING_AUTO_RETRY_BATCH_SIZE = "auto_retry_batch_size";

const INGEST_JOB_TYPES = new Set(["ingest_paths"]);
const CANCEL_REASON = "Sync di-restart dari CLI (pause lalu start)";

async function removeScanJobFromQueues(
  scanJobId: string,
  jobType: string | null
): Promise<number> {
  let removed = 0;
  const targets =
    jobType && INGEST_JOB_TYPES.has(jobType)
      ? [{ queue: ingestQueue, prefix: "ingest" }]
      : jobType
        ? [{ queue: discoverQueue, prefix: "discover" }]
        : [
            { queue: discoverQueue, prefix: "discover" },
            { queue: ingestQueue, prefix: "ingest" },
          ];

  for (const { queue, prefix } of targets) {
    const bullJob = await queue.getJob(`${prefix}-${scanJobId}`);
    if (bullJob) {
      await bullJob.remove();
      removed += 1;
    }
  }
  return removed;
}

export async function cancelAllSyncJobs(): Promise<{
  cancelledJobIds: string[];
  abandonedFiles: number;
  locksReleased: number;
  queueJobsRemoved: number;
}> {
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
    const lockKeys = await connection.keys("scan:lock:*");
    const locksReleased =
      lockKeys.length > 0 ? await connection.del(...lockKeys) : 0;
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
      errorMessage: CANCEL_REASON,
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
    abandonedFiles += await abandonInFlightSyncFiles(userId, CANCEL_REASON);
  }

  const lockKeys = await connection.keys("scan:lock:*");
  const locksReleased =
    lockKeys.length > 0 ? await connection.del(...lockKeys) : 0;

  return {
    cancelledJobIds: jobIds,
    abandonedFiles,
    locksReleased,
    queueJobsRemoved,
  };
}

async function applySyncOperationalDefaults(): Promise<void> {
  const batch = syncLimitForJobPayload();
  const ops: Array<{ key: string; value: string }> = [
    { key: SETTING_AUTO_SCAN_READY, value: "true" },
    { key: SETTING_AUTO_SCAN_BATCH_SIZE, value: String(batch) },
    { key: SETTING_AUTO_SCAN_ROOT_PATH, value: SYNC_ROOT_PATH },
    { key: SETTING_AUTO_SCAN_SUBTREES, value: "" },
    { key: SETTING_AUTO_RETRY_ENABLED, value: "true" },
    {
      key: SETTING_AUTO_RETRY_INTERVAL_MINUTES,
      value: String(AUTO_RETRY_INTERVAL_MINUTES),
    },
    {
      key: SETTING_AUTO_RETRY_BATCH_SIZE,
      value: String(AUTO_RETRY_BATCH_SIZE),
    },
  ];
  for (const { key, value } of ops) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

async function setAutoScanEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    await prisma.appSetting.upsert({
      where: { key: SETTING_AUTO_RETRY_ENABLED },
      create: { key: SETTING_AUTO_RETRY_ENABLED, value: "false" },
      update: { value: "false" },
    });
  } else {
    await applySyncOperationalDefaults();
  }

  await prisma.appSetting.upsert({
    where: { key: SETTING_AUTO_SCAN_ENABLED },
    create: {
      key: SETTING_AUTO_SCAN_ENABLED,
      value: enabled ? "true" : "false",
    },
    update: { value: enabled ? "true" : "false" },
  });
}

async function listUsersWithBappenasCreds(): Promise<
  Array<{ id: string; email: string }>
> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { email: "asc" },
  });
  const withCreds: Array<{ id: string; email: string }> = [];
  for (const u of users) {
    const creds = await getUserCloudCredentials(u.id);
    if (creds) withCreds.push({ id: u.id, email: u.email });
  }
  return withCreds;
}

export async function triggerDeltaSyncForAllUsers(): Promise<{
  enqueued: Array<{ userId: string; email: string; jobId: string }>;
  skippedActive: Array<{ userId: string; email: string; jobId: string }>;
  limit: number;
}> {
  const rootPath = SYNC_ROOT_PATH;
  const limit = syncLimitForJobPayload();
  const users = await listUsersWithBappenasCreds();

  if (users.length === 0) {
    throw new Error("Tidak ada user dengan kredensial Bappenas");
  }

  const enqueued: Array<{ userId: string; email: string; jobId: string }> = [];
  const skippedActive: Array<{ userId: string; email: string; jobId: string }> =
    [];

  for (const user of users) {
    if (await hasActiveScanJobForUser(user.id)) {
      const active = await prisma.scanJob.findFirst({
        where: {
          triggeredById: user.id,
          status: {
            in: [
              ScanJobStatus.PENDING,
              ScanJobStatus.RUNNING,
              ScanJobStatus.PAUSED,
            ],
          },
        },
        select: { id: true },
      });
      skippedActive.push({
        userId: user.id,
        email: user.email,
        jobId: active?.id ?? "?",
      });
      continue;
    }

    const job = await prisma.scanJob.create({
      data: {
        status: ScanJobStatus.PENDING,
        triggeredById: user.id,
        jobType: "delta_sync",
        selectedPaths: JSON.stringify({ rootPath, limit }),
      },
    });

    await enqueueScanJob(job.id);
    enqueued.push({ userId: user.id, email: user.email, jobId: job.id });
  }

  return { enqueued, skippedActive, limit };
}

export async function restartSyncPipeline(): Promise<void> {
  console.log("[sync-restart] pause: cancel jobs + matikan auto scan");
  const cancel = await cancelAllSyncJobs();
  await setAutoScanEnabled(false);
  console.log(
    `[sync-restart] cancelled ${cancel.cancelledJobIds.length} jobs, abandoned ${cancel.abandonedFiles} files, locks ${cancel.locksReleased}`
  );

  console.log("[sync-restart] start: aktifkan auto sync + delta semua user");
  await setAutoScanEnabled(true);
  const trigger = await triggerDeltaSyncForAllUsers();
  console.log(
    `[sync-restart] batch limit=${trigger.limit}, enqueued=${trigger.enqueued.length}, skipped=${trigger.skippedActive.length}`
  );
  for (const row of trigger.enqueued) {
    console.log(`  + ${row.email} job ${row.jobId}`);
  }
  for (const row of trigger.skippedActive) {
    console.log(`  skip ${row.email} (active ${row.jobId})`);
  }
}
