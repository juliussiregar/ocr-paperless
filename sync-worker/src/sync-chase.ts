import { ScanJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { enqueueScanJob } from "./scan-queues.js";
import { hasActiveScanJobForUser } from "./sync.js";
import { SYNC_ROOT_PATH, syncLimitForJobPayload } from "./sync-defaults.js";

const SETTING_AUTO_SCAN_ENABLED = "auto_scan_enabled";

async function isAutoScanEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({
    where: { key: SETTING_AUTO_SCAN_ENABLED },
  });
  return row?.value === "true";
}

/**
 * While auto-sync is ON, enqueue the next delta after a batch finishes
 * so remaining cloud files are picked up without waiting for the interval.
 */
export async function maybeChainNextDeltaSync(
  userId: string,
  reason: string
): Promise<boolean> {
  if (!(await isAutoScanEnabled())) return false;
  if (await hasActiveScanJobForUser(userId)) return false;

  const limit = syncLimitForJobPayload();
  const job = await prisma.scanJob.create({
    data: {
      status: ScanJobStatus.PENDING,
      triggeredById: userId,
      jobType: "delta_sync",
      selectedPaths: JSON.stringify({
        rootPath: SYNC_ROOT_PATH,
        limit,
      }),
    },
  });

  await enqueueScanJob(job.id);
  console.log(
    `[sync-chase] ${reason} → delta ${job.id} (batch=${limit === 0 ? "all" : limit})`
  );
  return true;
}
