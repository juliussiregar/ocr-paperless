import { NextResponse } from "next/server";
import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/session";
import { getAutoScanSettings } from "@/lib/app-settings";
import { getScanHealth } from "@/lib/scan-health";
import { listUsersWithBappenasCreds } from "@/lib/bappenas";
import { syncBatchSize } from "@/lib/sync-defaults";
import {
  emptyFileWarningWhere,
  isEmptyFileWarningMessage,
  legacyEmptyFileOrConditions,
} from "@/lib/empty-file-sync";
import { migrateLegacyEmptyFailedToWarnings } from "@/lib/retry-failed-sync";

const ACTIVE_STATUSES: ScanJobStatus[] = [
  ScanJobStatus.PENDING,
  ScanJobStatus.RUNNING,
  ScanJobStatus.PAUSED,
];

function phaseLabel(phase: string | null, jobType: string, status: string): string {
  if (status === "PENDING") return "Antri di worker";
  if (phase === "discovering") return "Scan folder cloud";
  if (phase === "queue") return "Antrian unduh";
  if (phase === "starting") return "Memulai";
  if (phase === "downloading" || jobType === "ingest_paths")
    return "Unduh + kirim OCR";
  if (phase === "done" || status === "COMPLETED") return "Selesai";
  if (status === "FAILED") return "Gagal";
  if (status === "CANCELLED") return "Dibatalkan";
  if (jobType === "reconcile_only") return "Cek status OCR";
  if (jobType === "delta_sync") return "Sync cloud";
  return phase ?? status;
}

function pct(current: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.round((current / total) * 100));
}

export async function GET() {
  const { error } = await requireAdminApi();
  if (error) return error;

  await migrateLegacyEmptyFailedToWarnings();

  const [settings, health, credsUsers, activeJobs, recentJobs, pipelineGlobal, embedPending, failedByError, emptyWarnings] =
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
      prisma.syncFile.groupBy({
        by: ["errorMessage"],
        where: {
          syncStatus: SyncStatus.FAILED,
          NOT: { OR: legacyEmptyFileOrConditions() },
        },
        _count: { _all: true },
      }),
      prisma.syncFile.count({
        where: emptyFileWarningWhere(),
      }),
    ]);

  const pipelineMap: Record<string, number> = {};
  for (const row of pipelineGlobal) {
    pipelineMap[row.syncStatus] = row._count._all;
  }

  const usersWithCreds = credsUsers.map((u) => u.id);
  const userMeta = await prisma.user.findMany({
    where: { id: { in: usersWithCreds } },
    select: {
      id: true,
      lastDiscoveryAt: true,
      lastScanCloudFiles: true,
      lastScanNeedsIngest: true,
      lastScanUnchanged: true,
    },
  });
  const lastDiscoveryMap = new Map(
    userMeta.map((row) => [row.id, row])
  );
  const perUser = await Promise.all(
    credsUsers.map(async (u) => {
      const meta = lastDiscoveryMap.get(u.id);
      const since = meta?.lastDiscoveryAt ?? null;
      const [
        ocrDone,
        ocrPending,
        downloading,
        discovered,
        queued,
        failed,
        warnings,
        failedRetryable,
        failedExhausted,
        ocrDoneSinceScan,
        duplicatesSinceScan,
        skippedSinceScan,
        activeJob,
      ] = await Promise.all([
          prisma.syncFile.count({
            where: { userId: u.id, syncStatus: SyncStatus.OCR_DONE },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.OCR_PENDING,
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.DOWNLOADING,
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.DISCOVERED,
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.QUEUED,
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              NOT: { OR: legacyEmptyFileOrConditions() },
            },
          }),
          prisma.syncFile.count({
            where: { userId: u.id, ...emptyFileWarningWhere() },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ingestRetryCount: 1,
              NOT: { OR: legacyEmptyFileOrConditions() },
            },
          }),
          prisma.syncFile.count({
            where: {
              userId: u.id,
              syncStatus: SyncStatus.FAILED,
              ingestRetryCount: { gte: 2 },
              NOT: { OR: legacyEmptyFileOrConditions() },
            },
          }),
          since
            ? prisma.syncFile.count({
                where: {
                  userId: u.id,
                  syncStatus: SyncStatus.OCR_DONE,
                  lastSyncedAt: { gte: since },
                },
              })
            : Promise.resolve(0),
          since
            ? prisma.syncFile.count({
                where: {
                  userId: u.id,
                  syncStatus: SyncStatus.SKIPPED,
                  lastSyncedAt: { gte: since },
                  errorMessage: { contains: "Duplikat konten" },
                },
              })
            : Promise.resolve(0),
          since
            ? prisma.syncFile.count({
                where: {
                  userId: u.id,
                  syncStatus: SyncStatus.SKIPPED,
                  lastSyncedAt: { gte: since },
                },
              })
            : Promise.resolve(0),
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

      const needsIngest = meta?.lastScanNeedsIngest ?? 0;
      const cloudFound = meta?.lastScanCloudFiles ?? 0;
      const unchanged = meta?.lastScanUnchanged ?? 0;
      const stillToDownload = discovered + queued + downloading;
      const downloaded = Math.max(0, needsIngest - stillToDownload);
      const scanned = ocrDoneSinceScan + duplicatesSinceScan;
      const downloadPct = pct(downloaded, needsIngest);
      const ocrPct = pct(scanned, needsIngest);

      return {
        userId: u.id,
        email: u.email,
        lastDiscoveryAt: since?.toISOString() ?? null,
        ocrDone,
        ocrPending: ocrPending + queued,
        downloading: downloading + discovered,
        failed,
        warnings,
        failedRetryable,
        failedExhausted,
        scan: {
          cloudFound,
          needsIngest,
          unchanged,
          stillToDownload,
          downloaded,
          ocrPending,
          ocrDoneSinceScan,
          duplicates: duplicatesSinceScan,
          skippedOther: Math.max(0, skippedSinceScan - duplicatesSinceScan),
          scanned,
          downloadPct,
          ocrPct,
        },
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
                activeJob.jobType === "ingest_paths" && activeJob.totalFiles > 0
                  ? pct(activeJob.processedFiles, activeJob.totalFiles)
                  : downloadPct,
            }
          : null,
      };
    })
  );

  const batchSize = syncBatchSize();
  const retryableFailed = failedByError.reduce((n, row) => n + row._count._all, 0);

  return NextResponse.json({
    at: new Date().toISOString(),
    settings,
    batchSize,
    batchUnlimited: batchSize === 0,
    credsUserCount: usersWithCreds.length,
    emptyFileWarning: {
      message:
        "Peringatan: file kosong (0 byte). Tidak bisa di-OCR. Perbaiki atau ganti file di Cloud Bappenas.",
      count: emptyWarnings,
    },
    failedBreakdown: [...failedByError]
      .filter((row) => !isEmptyFileWarningMessage(row.errorMessage))
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 8)
      .map((row) => ({
        errorMessage: row.errorMessage ?? "Unknown",
        count: row._count._all,
      })),
    pipeline: {
      ocrDone: pipelineMap.OCR_DONE ?? 0,
      ocrPending: pipelineMap.OCR_PENDING ?? 0,
      queued: pipelineMap.QUEUED ?? 0,
      downloading: pipelineMap.DOWNLOADING ?? 0,
      discovered: pipelineMap.DISCOVERED ?? 0,
      failed: retryableFailed,
      warnings: emptyWarnings,
      skipped: pipelineMap.SKIPPED ?? 0,
      deleted: pipelineMap.DELETED ?? 0,
      embedPending,
    },
    scanTotals: (() => {
      const cloudFound = perUser.reduce((n, u) => n + (u.scan?.cloudFound ?? 0), 0);
      const needsIngest = perUser.reduce(
        (n, u) => n + (u.scan?.needsIngest ?? 0),
        0
      );
      const downloaded = perUser.reduce(
        (n, u) => n + (u.scan?.downloaded ?? 0),
        0
      );
      const scanned = perUser.reduce((n, u) => n + (u.scan?.scanned ?? 0), 0);
      const duplicates = perUser.reduce(
        (n, u) => n + (u.scan?.duplicates ?? 0),
        0
      );
      const unchanged = perUser.reduce(
        (n, u) => n + (u.scan?.unchanged ?? 0),
        0
      );
      const stillToDownload = perUser.reduce(
        (n, u) => n + (u.scan?.stillToDownload ?? 0),
        0
      );
      return {
        cloudFound,
        needsIngest,
        unchanged,
        stillToDownload,
        downloaded,
        scanned,
        duplicates,
        downloadPct: pct(downloaded, needsIngest),
        ocrPct: pct(scanned, needsIngest),
      };
    })(),
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
