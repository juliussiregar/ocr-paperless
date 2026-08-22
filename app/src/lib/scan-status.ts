import { ScanJobStatus } from "@prisma/client";

/**
 * Status that block a new ingest.
 * Use notIn(finished) so older Prisma runtimes without PAUSED still match
 * paused jobs after the DB enum was extended.
 */
export const FINISHED_SCAN_STATUSES: ScanJobStatus[] = [
  ScanJobStatus.COMPLETED,
  ScanJobStatus.FAILED,
  ScanJobStatus.CANCELLED,
];

export function activeScanJobWhere(userId: string) {
  return {
    triggeredById: userId,
    status: { notIn: FINISHED_SCAN_STATUSES },
  };
}
