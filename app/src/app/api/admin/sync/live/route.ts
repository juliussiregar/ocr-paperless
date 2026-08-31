import { NextResponse } from "next/server";
import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/session";
import { getAutoScanSettings } from "@/lib/app-settings";
import { getScanHealth, ingestMaxRetries } from "@/lib/scan-health";
import { listUsersWithBappenasCreds } from "@/lib/bappenas";
import { syncBatchSize } from "@/lib/sync-defaults";

const ACTIVE_STATUSES: ScanJobStatus[] = [
  ScanJobStatus.PENDING,
  ScanJobStatus.RUNNING,
  ScanJobStatus.PAUSED,
];

function phaseLabel(phase: string | null, jobType: string, status: string): string {
  if (status === "PENDING") return "Antri di worker";
  if (phase === "discovering") return "Scan folder cloud";
  if (phase === "starting") return "Memulai";
  if (phase === "downloading" || jobType === "ingest_paths")
    return "Unduh + kirim OCR";
  if (phase === "done" || status === "COMPLETED") return "Selesai";
  if (status === "FAILED") return "Gagal";
  if (status === "CANCELLED") return "Dibatalkan";
  return phase ?? status;
}

export async function GET() {
  const { error } = await requireAdminApi();
  if (error) return error;

  const maxRetries = ingestMaxRetries();
  const [settings, health, credsUsers, activeJobs, recentJobs, pipelineGlobal, embedPending] =
    await Promise.all([
      getAutoScanSettings(),
      getScanHealth(),
      listUsersWithBappenasCreds(),
      prisma.scanJob.findMany({
        where: { status: { in: ACTIVE_STATUSES } },
        orderBy: { startedAt: "desc" },
        include: {
          triggeredBy: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.scanJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          triggeredBy: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.syncFile.groupBy({
        by: ["syncStatus"],
        _count: { _all: true },
      }),
      prisma.syncFile.count({
        where: {
          syncStatus: SyncStatus.OCR_DONE,
          paperlessDocumentId: { not: null },
          chunks: { none: {} },
        },
      }),
    ]);

  const pipelineMap: Record<string, number> = {};
  for (const row of pipelineGlobal) {
    pipelineMap[row.syncStatus] = row._count._all;
  }

  const usersWithCreds = credsUsers.map((u) => u.id);
  const userMeta = await prisma.user.findMany({
    where: { id: { in: usersWithCreds } },
    select: { id: true, lastDiscoveryAt: true },
  });
  const lastDiscoveryMap = new Map(
    userMeta.map((row) => [row.id, row.lastDiscoveryAt])
  );
  const perUser = await Promise.all(
    credsUsers.map(async (u) => {
      const [
        ocrDone,
        ocrPending,
        downloading,
        failed,
        failedRetryable,
        failedExhausted,
        activeJob,
      ] = await Promise.all([
          prisma.syncFile.count({
            where: { userId: u.id, syncStatus: SyncStatus.OCR_DONE },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: {
                in: [SyncStatus.OCR_PENDING, SyncStatus.QUEUED],
              },
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: {
                in: [SyncStatus.DOWNLOADING, SyncStatus.DISCOVERED],
              },
            },
          }),
          prisma.syncFile.count({
            where: { userId: u.id, syncStatus: SyncStatus.FAILED },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ingestRetryCount: { lt: maxRetries },
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ingestRetryCount: { gte: maxRetries },
            },
          }),
          prisma.scanJob.findFirst({
            where: {
              triggeredById: u.id,
              status: { in: ACTIVE_STATUSES },
            },
            select: {
              id: true,
              jobType: true,
              status: true,
              phase: true,
              totalFiles: true,
              processedFiles: true,
              skippedFiles: true,
              failedFiles: true,
              newFiles: true,
              currentFile: true,
              startedAt: true,
              errorMessage: true,
            },
          }),
        ]);
      return {
        userId: u.id,
        email: u.email,
        lastDiscoveryAt:
          lastDiscoveryMap.get(u.id)?.toISOString() ?? null,
        ocrDone,
        ocrPending,
        downloading,
        failed,
        failedRetryable,
        failedExhausted,
        scanLockHeld: health.userLocks.includes(u.id),
        activeJob: activeJob
          ? {
              ...activeJob,
              phaseLabel: phaseLabel(
                activeJob.phase,
                activeJob.jobType,
                activeJob.status
              ),
              startedAt: activeJob.startedAt?.toISOString() ?? null,
              progressPct:
                activeJob.totalFiles > 0
                  ? Math.round(
                      (activeJob.processedFiles / activeJob.totalFiles) * 100
                    )
                  : null,
            }
          : null,
      };
    })
  );

  const batchSize = syncBatchSize();

  return NextResponse.json({
    at: new Date().toISOString(),
    settings,
    batchSize,
    batchUnlimited: batchSize === 0,
    credsUserCount: usersWithCreds.length,
    pipeline: {
      ocrDone: pipelineMap.OCR_DONE ?? 0,
      ocrPending: pipelineMap.OCR_PENDING ?? 0,
      queued: pipelineMap.QUEUED ?? 0,
      downloading: pipelineMap.DOWNLOADING ?? 0,
      discovered: pipelineMap.DISCOVERED ?? 0,
      failed: pipelineMap.FAILED ?? 0,
      skipped: pipelineMap.SKIPPED ?? 0,
      deleted: pipelineMap.DELETED ?? 0,
      embedPending,
    },
    health,
    activeJobs: activeJobs.map((j) => ({
      id: j.id,
      jobType: j.jobType,
      status: j.status,
      phase: j.phase,
      phaseLabel: phaseLabel(j.phase, j.jobType, j.status),
      totalFiles: j.totalFiles,
      processedFiles: j.processedFiles,
      skippedFiles: j.skippedFiles,
      failedFiles: j.failedFiles,
      newFiles: j.newFiles,
      currentFile: j.currentFile,
      errorMessage: j.errorMessage,
      startedAt: j.startedAt?.toISOString() ?? null,
      progressPct:
        j.totalFiles > 0
          ? Math.round((j.processedFiles / j.totalFiles) * 100)
          : null,
      user: j.triggeredBy
        ? {
            id: j.triggeredBy.id,
            email: j.triggeredBy.email,
            name: j.triggeredBy.name,
          }
        : null,
    })),
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      jobType: j.jobType,
      status: j.status,
      phase: j.phase,
      phaseLabel: phaseLabel(j.phase, j.jobType, j.status),
      totalFiles: j.totalFiles,
      processedFiles: j.processedFiles,
      skippedFiles: j.skippedFiles,
      failedFiles: j.failedFiles,
      newFiles: j.newFiles,
      errorMessage: j.errorMessage,
      currentFile: j.currentFile,
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
      createdAt: j.createdAt.toISOString(),
      durationMs:
        j.startedAt && j.completedAt
          ? j.completedAt.getTime() - j.startedAt.getTime()
          : null,
      user: j.triggeredBy
        ? { email: j.triggeredBy.email, name: j.triggeredBy.name }
        : null,
    })),
    users: perUser,
  });
}
