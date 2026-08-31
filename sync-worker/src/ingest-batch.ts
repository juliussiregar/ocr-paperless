import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma } from "./db.js";
import {
  ScanAbortedError,
  discardTemp,
  moveTempToConsume,
  type RemoteFile,
} from "./webdav.js";
import { findPaperlessDocumentByChecksum } from "./paperless.js";
import {
  hasRemoteMetadataChanged,
  isDoneSyncStatus,
  metadataPatchFromRemote,
  type RemoteMeta,
} from "./sync-meta.js";
import {
  abandonInFlightSyncFiles,
  downloadConcurrency,
  isCancelled,
  waitIfPaused,
} from "./sync-job-helpers.js";
import { invalidateAfterScanJob } from "./listing-cache.js";
import { markSyncFileFailed } from "./sync-fail.js";

const EMPTY_CONTENT_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const EMPTY_FILE_ERROR =
  "File kosong (0 byte). Tidak bisa di-OCR. Periksa atau ganti file di Cloud Bappenas.";

function isEmptyDownload(size: number, hash: string): boolean {
  return size === 0 || hash === EMPTY_CONTENT_HASH;
}

async function withRetries<T>(
  fn: () => Promise<T>,
  attempts = 3,
  label = "operation"
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ScanAbortedError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/download timeout|timeout setelah|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) {
        throw err;
      }
      last = err;
      if (i < attempts - 1) {
        const waitMs = 1000 * (i + 1);
        console.warn(
          `[retry] ${label} attempt ${i + 1}/${attempts} failed, wait ${waitMs}ms:`,
          msg
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw last;
}

type WebDavClient = {
  downloadToTemp: (
    remotePath: string,
    opts?: { signal?: AbortSignal }
  ) => Promise<{ tempPath: string; hash: string; size: number }>;
};

/** Download + dedup + OCR submit for a list of paths (ingest & delta jobs). */
export async function runIngestPathsForJob(
  jobId: string,
  userId: string,
  client: WebDavClient,
  paths: string[],
  metaByPath?: Map<string, RemoteMeta>,
  opts?: { skippedBeforeIngest?: number }
): Promise<void> {
  let processed = 0;
  let skipped = opts?.skippedBeforeIngest ?? 0;
  let failed = 0;
  let newFiles = 0;
  let cancelledMid = false;
  const sharedAbort = new AbortController();

  const markCancelledLocal = () => {
    cancelledMid = true;
    if (!sharedAbort.signal.aborted) sharedAbort.abort();
  };

  const bumpJobProgress = async () => {
    if (await isCancelled(jobId)) return;
    await prisma.scanJob.updateMany({
      where: {
        id: jobId,
        status: { in: [ScanJobStatus.RUNNING, ScanJobStatus.PAUSED] },
      },
      data: {
        processedFiles: processed,
        skippedFiles: skipped,
        failedFiles: failed,
        newFiles,
      },
    });
  };

  const ingestOnePath = async (
    remotePath: string,
    remoteMeta?: RemoteMeta
  ): Promise<void> => {
    if (cancelledMid || sharedAbort.signal.aborted) return;

    const pauseState = await waitIfPaused(jobId);
    if (pauseState === "cancelled" || (await isCancelled(jobId))) {
      markCancelledLocal();
      return;
    }

    const fileName =
      remoteMeta?.basename ??
      remotePath.split("/").filter(Boolean).pop() ??
      remotePath;
    let tempPath: string | null = null;

    try {
      const existingBefore = await prisma.syncFile.findUnique({
        where: { userId_remotePath: { userId, remotePath } },
      });

      if (
        remoteMeta &&
        existingBefore &&
        isDoneSyncStatus(existingBefore.syncStatus) &&
        !hasRemoteMetadataChanged(existingBefore, remoteMeta)
      ) {
        await prisma.syncFile.update({
          where: { id: existingBefore.id },
          data: metadataPatchFromRemote(remoteMeta, new Date()),
        });
        skipped++;
        processed++;
        await bumpJobProgress();
        return;
      }

      if (
        remoteMeta?.etag &&
        remoteMeta.size != null &&
        remoteMeta.size > 0
      ) {
        const peerByMeta = await prisma.syncFile.findFirst({
          where: {
            userId,
            etag: remoteMeta.etag,
            fileSize: BigInt(remoteMeta.size),
            syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
            paperlessDocumentId: { not: null },
            NOT: { remotePath },
          },
        });
        if (peerByMeta?.paperlessDocumentId) {
          await prisma.syncFile.upsert({
            where: { userId_remotePath: { userId, remotePath } },
            create: {
              userId,
              remotePath,
              syncStatus: SyncStatus.SKIPPED,
              paperlessDocumentId: peerByMeta.paperlessDocumentId,
              contentHash: peerByMeta.contentHash,
              ...metadataPatchFromRemote(remoteMeta, new Date()),
            },
            update: {
              syncStatus: SyncStatus.SKIPPED,
              paperlessDocumentId: peerByMeta.paperlessDocumentId,
              contentHash: peerByMeta.contentHash,
              ...metadataPatchFromRemote(remoteMeta, new Date()),
              lastSyncedAt: new Date(),
              errorMessage: null,
            },
          });
          skipped++;
          processed++;
          await bumpJobProgress();
          return;
        }
      }

      if (remoteMeta?.fileId) {
        const byFileId = await prisma.syncFile.findFirst({
          where: {
            userId,
            remoteFileId: remoteMeta.fileId,
            syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
          },
        });
        if (
          byFileId &&
          byFileId.remotePath !== remotePath &&
          !hasRemoteMetadataChanged(byFileId, remoteMeta)
        ) {
          const staleAtPath = await prisma.syncFile.findUnique({
            where: { userId_remotePath: { userId, remotePath } },
          });
          if (staleAtPath && staleAtPath.id !== byFileId.id && !staleAtPath.paperlessDocumentId) {
            await prisma.syncFile.delete({ where: { id: staleAtPath.id } });
          }
          await prisma.syncFile.update({
            where: { id: byFileId.id },
            data: {
              ...metadataPatchFromRemote(remoteMeta, new Date()),
              previousRemotePath: byFileId.remotePath,
              remotePath,
              fileName,
            },
          });
          skipped++;
          processed++;
          await bumpJobProgress();
          return;
        }
      }

      await prisma.scanJob.updateMany({
        where: {
          id: jobId,
          status: { in: [ScanJobStatus.RUNNING, ScanJobStatus.PAUSED] },
        },
        data: { phase: "downloading", currentFile: fileName },
      });

      const upsertMeta = remoteMeta
        ? {
            etag: remoteMeta.etag,
            lastModified: remoteMeta.lastModified,
            fileSize:
              remoteMeta.size != null ? BigInt(remoteMeta.size) : undefined,
            mimeType: remoteMeta.mimeType,
            remoteFileId: remoteMeta.fileId ?? undefined,
            lastSeenAt: new Date(),
          }
        : {};

      await prisma.syncFile.upsert({
        where: { userId_remotePath: { userId, remotePath } },
        create: {
          userId,
          remotePath,
          fileName,
          syncStatus: SyncStatus.DOWNLOADING,
          ...upsertMeta,
        },
        update: {
          syncStatus: SyncStatus.DOWNLOADING,
          errorMessage: null,
          fileName,
          ...upsertMeta,
        },
      });

      const downloaded = await withRetries(
        () =>
          client.downloadToTemp(remotePath, { signal: sharedAbort.signal }),
        3,
        `download ${fileName}`
      );
      tempPath = downloaded.tempPath;
      const hash = downloaded.hash;

      if (cancelledMid || (await isCancelled(jobId))) {
        await discardTemp(tempPath);
        tempPath = null;
        markCancelledLocal();
        return;
      }

      if (isEmptyDownload(downloaded.size, hash)) {
        await discardTemp(tempPath);
        tempPath = null;
        await prisma.syncFile.update({
          where: { userId_remotePath: { userId, remotePath } },
          data: {
            contentHash: hash,
            fileSize: BigInt(0),
            syncStatus: SyncStatus.FAILED,
            errorMessage: EMPTY_FILE_ERROR,
            ocrPendingAt: null,
            ingestRetryCount: { increment: 1 },
          },
        });
        failed++;
        processed++;
        await bumpJobProgress();
        return;
      }

      const duplicateByHash = await prisma.syncFile.findFirst({
        where: {
          contentHash: hash,
          syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
          paperlessDocumentId: { not: null },
          NOT: { userId, remotePath },
        },
      });

      if (duplicateByHash?.paperlessDocumentId) {
        await discardTemp(tempPath);
        tempPath = null;
        if (cancelledMid || (await isCancelled(jobId))) {
          markCancelledLocal();
          return;
        }
        await prisma.syncFile.update({
          where: { userId_remotePath: { userId, remotePath } },
          data: {
            contentHash: hash,
            fileSize: BigInt(downloaded.size),
            syncStatus: SyncStatus.SKIPPED,
            paperlessDocumentId: duplicateByHash.paperlessDocumentId,
            lastSyncedAt: new Date(),
          },
        });
        skipped++;
        processed++;
        await bumpJobProgress();
        return;
      }

      const existingPaperlessId = await findPaperlessDocumentByChecksum(hash);
      if (existingPaperlessId) {
        await discardTemp(tempPath);
        tempPath = null;
        if (cancelledMid || (await isCancelled(jobId))) {
          markCancelledLocal();
          return;
        }
        await prisma.syncFile.update({
          where: { userId_remotePath: { userId, remotePath } },
          data: {
            contentHash: hash,
            fileSize: BigInt(downloaded.size),
            syncStatus: SyncStatus.OCR_DONE,
            paperlessDocumentId: existingPaperlessId,
            lastSyncedAt: new Date(),
          },
        });
        skipped++;
        processed++;
        await bumpJobProgress();
        return;
      }

      if (cancelledMid || (await isCancelled(jobId))) {
        await discardTemp(tempPath);
        tempPath = null;
        markCancelledLocal();
        return;
      }

      await prisma.scanJob.updateMany({
        where: {
          id: jobId,
          status: { in: [ScanJobStatus.RUNNING, ScanJobStatus.PAUSED] },
        },
        data: { phase: "submitting", currentFile: fileName },
      });

      await prisma.syncFile.update({
        where: { userId_remotePath: { userId, remotePath } },
        data: { syncStatus: SyncStatus.QUEUED },
      });

      await withRetries(
        async () => {
          if (!tempPath) throw new Error("Temp file missing");
          if (cancelledMid || (await isCancelled(jobId))) {
            throw new ScanAbortedError();
          }
          await moveTempToConsume(tempPath, fileName);
          tempPath = null;
        },
        3,
        `submit ${fileName}`
      );

      if (cancelledMid || (await isCancelled(jobId))) {
        markCancelledLocal();
        return;
      }

      await prisma.syncFile.update({
        where: { userId_remotePath: { userId, remotePath } },
        data: {
          contentHash: hash,
          fileSize: BigInt(downloaded.size),
          syncStatus: SyncStatus.OCR_PENDING,
          ocrPendingAt: new Date(),
          errorMessage: null,
          lastSyncedAt: new Date(),
        },
      });

      newFiles++;
      processed++;
      await bumpJobProgress();
    } catch (err) {
      await discardTemp(tempPath);
      tempPath = null;
      if (err instanceof ScanAbortedError || (await isCancelled(jobId))) {
        markCancelledLocal();
        return;
      }
      failed++;
      const message = err instanceof Error ? err.message : "Unknown error";
      await markSyncFileFailed(userId, remotePath, message);
      processed++;
      await bumpJobProgress();
    }
  };

  const cancelWatch = setInterval(() => {
    void isCancelled(jobId).then((c) => {
      if (c) markCancelledLocal();
    });
  }, 800);

  try {
    const conc = downloadConcurrency();
    console.log(
      `[ingest ${jobId}] downloading ${paths.length} files (concurrency=${conc})`
    );
    let next = 0;
    const runners = Array.from(
      { length: Math.min(conc, paths.length || 1) },
      async () => {
        while (next < paths.length && !cancelledMid) {
          const idx = next++;
          const remotePath = paths[idx]!;
          await ingestOnePath(remotePath, metaByPath?.get(remotePath));
        }
      }
    );
    await Promise.allSettled(runners);

    if (cancelledMid || (await isCancelled(jobId))) {
      const abandoned = await abandonInFlightSyncFiles(
        userId,
        "Dibatalkan sebelum dikirim ke OCR"
      );
      await prisma.scanJob.updateMany({
        where: {
          id: jobId,
          status: {
            in: [
              ScanJobStatus.RUNNING,
              ScanJobStatus.PAUSED,
              ScanJobStatus.CANCELLED,
            ],
          },
        },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
          processedFiles: processed,
          skippedFiles: skipped,
          failedFiles: failed + abandoned,
          newFiles,
          errorMessage:
            abandoned > 0
              ? `Cancelled by user (${abandoned} file antre dibersihkan)`
              : "Cancelled by user",
          phase: "done",
          currentFile: null,
        },
      });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { lastSyncAt: new Date() },
    });

    await prisma.scanJob.updateMany({
      where: {
        id: jobId,
        status: { in: [ScanJobStatus.RUNNING, ScanJobStatus.PAUSED] },
      },
      data: {
        status: ScanJobStatus.COMPLETED,
        completedAt: new Date(),
        processedFiles: processed,
        skippedFiles: skipped,
        failedFiles: failed,
        newFiles,
        phase: "done",
        currentFile: null,
      },
    });

    const jobRow = await prisma.scanJob.findUnique({
      where: { id: jobId },
      select: { selectedPaths: true },
    });
    await invalidateAfterScanJob(
      userId,
      jobRow?.selectedPaths ?? null,
      paths
    );
  } catch (err) {
    if (err instanceof ScanAbortedError || (await isCancelled(jobId))) {
      const abandoned = await abandonInFlightSyncFiles(
        userId,
        "Dibatalkan sebelum dikirim ke OCR"
      );
      await prisma.scanJob.updateMany({
        where: {
          id: jobId,
          status: {
            in: [
              ScanJobStatus.RUNNING,
              ScanJobStatus.PAUSED,
              ScanJobStatus.CANCELLED,
            ],
          },
        },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage:
            abandoned > 0
              ? `Cancelled by user (${abandoned} file dibersihkan)`
              : "Cancelled by user",
          phase: "done",
          currentFile: null,
        },
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Ingest failed";
    await prisma.scanJob.updateMany({
      where: {
        id: jobId,
        status: { in: [ScanJobStatus.RUNNING, ScanJobStatus.PAUSED] },
      },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: message,
        completedAt: new Date(),
        phase: "done",
        currentFile: null,
      },
    });
    throw err;
  } finally {
    clearInterval(cancelWatch);
  }
}

export type IngestPathsPayload = {
  mode: "paths";
  paths: string[];
  meta?: Record<string, RemoteMeta>;
  skippedBeforeIngest?: number;
  parentJobId?: string;
  source?: string;
};

export function serializeIngestPathsPayload(
  paths: string[],
  metaByPath: Map<string, RemoteMeta>,
  skippedBeforeIngest: number,
  parentJobId?: string
): string {
  const meta: Record<string, RemoteMeta> = {};
  for (const p of paths) {
    const m = metaByPath.get(p);
    if (m) meta[p] = m;
  }
  return JSON.stringify({
    mode: "paths",
    paths,
    meta,
    skippedBeforeIngest,
    parentJobId,
  } satisfies IngestPathsPayload);
}

export function parseIngestPathsPayload(raw: string | null): IngestPathsPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as IngestPathsPayload;
    if (parsed?.mode !== "paths" || !Array.isArray(parsed.paths)) return null;
    return {
      mode: "paths",
      paths: parsed.paths.filter((p) => typeof p === "string"),
      meta: parsed.meta ?? {},
      skippedBeforeIngest: Number(parsed.skippedBeforeIngest) || 0,
      parentJobId: parsed.parentJobId,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}

/** Phase 3: ingest-only job (runs on ingest queue with user lock). */
export async function runIngestPathsJob(jobId: string): Promise<void> {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === ScanJobStatus.CANCELLED) return;
  if (!job.triggeredById) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: "Scan job has no user",
        completedAt: new Date(),
      },
    });
    return;
  }

  const payload = parseIngestPathsPayload(job.selectedPaths);
  if (!payload || payload.paths.length === 0) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.COMPLETED,
        completedAt: new Date(),
        phase: "done",
        errorMessage: "Tidak ada path untuk ingest",
      },
    });
    return;
  }

  const { claimJobRunning } = await import("./sync-job-helpers.js");
  const claimed = await claimJobRunning(jobId, {
    phase: "downloading",
    totalFiles: payload.paths.length,
    processedFiles: 0,
  });
  if (!claimed) return;

  const { getUserCloudCredentials } = await import("./db.js");
  const creds = await getUserCloudCredentials(job.triggeredById);
  if (!creds) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: "Kredensial Cloud Bappenas belum diisi",
        completedAt: new Date(),
      },
    });
    return;
  }

  const { createWebDavClient } = await import("./webdav.js");
  const client = createWebDavClient(creds.url, creds.username, creds.password);
  const metaMap = new Map<string, RemoteMeta>();
  for (const p of payload.paths) {
    const m = payload.meta?.[p];
    if (m) metaMap.set(p, m);
  }

  await runIngestPathsForJob(
    jobId,
    job.triggeredById,
    client,
    payload.paths,
    metaMap,
    { skippedBeforeIngest: payload.skippedBeforeIngest }
  );
}
