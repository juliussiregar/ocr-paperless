import { ScanJobStatus } from "@prisma/client";
import { prisma } from "./db.js";

/** True while any scan job holds DB/WebDAV load (discover, ingest, reconcile). */
export async function isHeavySyncActive(): Promise<boolean> {
  const n = await prisma.scanJob.count({
    where: {
      status: {
        in: [
          ScanJobStatus.PENDING,
          ScanJobStatus.RUNNING,
          ScanJobStatus.PAUSED,
        ],
      },
    },
  });
  return n > 0;
}

export async function isHeavySyncActiveForUser(userId: string): Promise<boolean> {
  const n = await prisma.scanJob.count({
    where: {
      triggeredById: userId,
      status: {
        in: [
          ScanJobStatus.PENDING,
          ScanJobStatus.RUNNING,
          ScanJobStatus.PAUSED,
        ],
      },
    },
  });
  return n > 0;
}
