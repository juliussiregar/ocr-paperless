import { ScanJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { markSyncFilesFailedInFlight } from "./sync-fail.js";
import { effectiveIngestLimit, syncBatchSize } from "./sync-defaults.js";

/** 0 = unlimited. Applies to folder/all/selected/newest ceilings. */
export function scanMaxFiles(): number {
  return syncBatchSize();
}

export function ingestCap(explicit?: number | null): number {
  return effectiveIngestLimit(explicit);
}

export function downloadConcurrency(): number {
  const n = Number(process.env.WEBDAV_DOWNLOAD_CONCURRENCY ?? "14");
  if (!Number.isFinite(n)) return 14;
  return Math.min(20, Math.max(1, Math.floor(n)));
}

export async function isCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.scanJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === ScanJobStatus.CANCELLED;
}

export async function waitIfPaused(jobId: string): Promise<"ok" | "cancelled"> {
  for (;;) {
    const job = await prisma.scanJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (!job || job.status === ScanJobStatus.CANCELLED) return "cancelled";
    if (job.status === ScanJobStatus.PAUSED) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    return "ok";
  }
}

export async function claimJobRunning(
  jobId: string,
  data: {
    phase?: string;
    processedFiles?: number;
    totalFiles?: number;
    currentFile?: string | null;
  } = {}
): Promise<boolean> {
  const result = await prisma.scanJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [
          ScanJobStatus.PENDING,
          ScanJobStatus.PAUSED,
          ScanJobStatus.RUNNING,
        ],
      },
    },
    data: {
      status: ScanJobStatus.RUNNING,
      startedAt: new Date(),
      ...data,
    },
  });
  return result.count > 0;
}

export async function abandonInFlightSyncFiles(
  userId: string,
  reason: string
): Promise<number> {
  return markSyncFilesFailedInFlight(userId, reason);
}
