import { ScanJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueScanJob } from "@/lib/queue";
import { writeAudit } from "@/lib/audit";
import { activeScanJobWhere } from "@/lib/scan-status";
import { listUsersWithBappenasCreds } from "@/lib/bappenas";
import { SYNC_ROOT_PATH, syncLimitForJobPayload } from "@/lib/sync-defaults";

export type TriggerAllSyncResult = {
  enqueued: Array<{ userId: string; email: string; jobId: string }>;
  skippedActive: Array<{ userId: string; email: string; jobId: string }>;
  totalWithCreds: number;
  rootPath: string;
  limit: number;
};

export async function triggerDeltaSyncForAllUsers(
  adminUserId: string,
  options?: { rootPath?: string; limit?: number }
): Promise<TriggerAllSyncResult> {
  const rootPath =
    options?.rootPath?.trim() ? options.rootPath.trim() : SYNC_ROOT_PATH;
  const limit = options?.limit ?? syncLimitForJobPayload();

  const users = await listUsersWithBappenasCreds();
  if (users.length === 0) {
    throw new Error("Tidak ada user dengan kredensial Bappenas");
  }

  const enqueued: TriggerAllSyncResult["enqueued"] = [];
  const skippedActive: TriggerAllSyncResult["skippedActive"] = [];

  for (const user of users) {
    const active = await prisma.scanJob.findFirst({
      where: activeScanJobWhere(user.id),
      select: { id: true },
    });
    if (active) {
      skippedActive.push({
        userId: user.id,
        email: user.email,
        jobId: active.id,
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

    await enqueueScanJob(job.id, job.jobType);
    enqueued.push({ userId: user.id, email: user.email, jobId: job.id });
  }

  await writeAudit("admin.scan.trigger_all", adminUserId, {
    rootPath,
    limit,
    enqueuedCount: enqueued.length,
    skippedActiveCount: skippedActive.length,
    totalWithCreds: users.length,
  });

  return {
    enqueued,
    skippedActive,
    totalWithCreds: users.length,
    rootPath,
    limit,
  };
}
