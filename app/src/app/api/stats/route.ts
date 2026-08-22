import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

export async function GET() {
  const session = await requireAuth();
  const userId = session.user.id;

  const ocrDone = await prisma.syncFile.count({
    where: { userId, syncStatus: SyncStatus.OCR_DONE },
  });

  const ocrPending = await prisma.syncFile.count({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.OCR_PENDING, SyncStatus.QUEUED] },
    },
  });

  const failed = await prisma.syncFile.count({
    where: { userId, syncStatus: SyncStatus.FAILED },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastSyncAt: true },
  });

  const latestJob = await prisma.scanJob.findFirst({
    where: { triggeredById: userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    documentCount: ocrDone,
    ocrDone,
    ocrPending,
    failed,
    lastSyncAt: user?.lastSyncAt ?? null,
    latestJob,
  });
}
