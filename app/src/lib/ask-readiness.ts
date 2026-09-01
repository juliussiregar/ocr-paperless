import { SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AskReadiness = {
  ocrReady: number;
  withEmbeddings: number;
  ocrPending: number;
  failed: number;
  downloading: number;
  readinessPct: number;
  embedPct: number;
};

export async function getAskReadinessForUser(userId: string): Promise<AskReadiness> {
  const rows = await prisma.syncFile.groupBy({
    by: ["syncStatus"],
    where: { userId, paperlessDocumentId: { not: null } },
    _count: { _all: true },
  });

  const count = (status: SyncStatus) =>
    rows.find((r) => r.syncStatus === status)?._count._all ?? 0;

  const ocrReady = count(SyncStatus.OCR_DONE) + count(SyncStatus.SKIPPED);
  const ocrPending = count(SyncStatus.OCR_PENDING);
  const failed = count(SyncStatus.FAILED);
  const downloading =
    count(SyncStatus.DOWNLOADING) + count(SyncStatus.QUEUED);

  const readyDocs = await prisma.syncFile.findMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
    },
    select: { paperlessDocumentId: true },
  });
  const docIds = [
    ...new Set(
      readyDocs
        .map((r) => r.paperlessDocumentId)
        .filter((id): id is number => id != null)
    ),
  ];

  let withEmbeddings = 0;
  if (docIds.length > 0) {
    const embedded = await prisma.documentChunk.groupBy({
      by: ["paperlessDocumentId"],
      where: { userId, paperlessDocumentId: { in: docIds } },
    });
    withEmbeddings = embedded.length;
  }

  const readinessPct =
    ocrReady > 0 ? Math.round((ocrReady / (ocrReady + ocrPending + failed)) * 100) : 0;
  const embedPct =
    docIds.length > 0 ? Math.round((withEmbeddings / docIds.length) * 100) : 0;

  return {
    ocrReady,
    withEmbeddings,
    ocrPending,
    failed,
    downloading,
    readinessPct,
    embedPct,
  };
}

export async function getAskReadinessGlobal(): Promise<{
  users: number;
  ocrReady: number;
  withEmbeddings: number;
  ocrPending: number;
  failed: number;
  chunksTotal: number;
}> {
  const fileRows = await prisma.syncFile.groupBy({
    by: ["syncStatus"],
    where: { paperlessDocumentId: { not: null } },
    _count: { _all: true },
  });
  const count = (status: SyncStatus) =>
    fileRows.find((r) => r.syncStatus === status)?._count._all ?? 0;

  const users = await prisma.user.count();
  const chunksTotal = await prisma.documentChunk.count();
  const embedded = await prisma.documentChunk.groupBy({
    by: ["paperlessDocumentId"],
  });

  return {
    users,
    ocrReady: count(SyncStatus.OCR_DONE) + count(SyncStatus.SKIPPED),
    withEmbeddings: embedded.length,
    ocrPending: count(SyncStatus.OCR_PENDING),
    failed: count(SyncStatus.FAILED),
    chunksTotal,
  };
}
