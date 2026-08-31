import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma, getUserCloudCredentials } from "./db.js";
import { createWebDavClient, ScanAbortedError, type RemoteFile } from "./webdav.js";
import {
  hasRemoteMetadataChanged,
  isDoneSyncStatus,
  metadataPatchFromRemote,
  remoteMetaFromFile,
  type RemoteMeta,
} from "./sync-meta.js";
import {
  abandonInFlightSyncFiles,
  claimJobRunning,
  isCancelled,
  waitIfPaused,
} from "./sync-job-helpers.js";
import { serializeIngestPathsPayload } from "./ingest-batch.js";
import { enqueueScanJob } from "./scan-queues.js";
import { invalidateAfterScanJob } from "./listing-cache.js";
import {
  effectiveIngestLimit,
  SYNC_NO_LIMIT,
} from "./sync-defaults.js";
import {
  loadFolderSnapshots,
  shouldSkipFolderListing,
  upsertFolderSnapshot,
  flushPendingFolderSnapshots,
} from "./folder-cache.js";
import {
  countDiscoveredPending,
  shouldDrainQueueOnly,
  takeDiscoveredBatch,
  upsertDiscoveredOverflow,
} from "./pending-queue.js";

export type DeltaSyncPayload = {
  rootPath: string;
  limit: number;
  reconcileOnly?: boolean;
  /** Skip walk when DISCOVERED queue is warm (chase). */
  preferQueue?: boolean;
  /** Always walk cloud (manual Sync cloud / restart). */
  forceWalk?: boolean;
};

type ExistingRow = Awaited<
  ReturnType<typeof prisma.syncFile.findMany>
>[number];

function normalizeRootPath(rootPath: string): string | null {
  if (!rootPath || rootPath === "/") return null;
  const p = rootPath.startsWith("/") ? rootPath : `/${rootPath}`;
  return p.replace(/\/$/, "") || null;
}

function pathUnderRoot(remotePath: string, rootPrefix: string | null): boolean {
  if (!rootPrefix) return true;
  return remotePath === rootPrefix || remotePath.startsWith(`${rootPrefix}/`);
}

async function clearPathCollision(
  userId: string,
  remotePath: string,
  keepId: string
): Promise<void> {
  const stale = await prisma.syncFile.findUnique({
    where: { userId_remotePath: { userId, remotePath } },
  });
  if (!stale || stale.id === keepId) return;
  if (stale.paperlessDocumentId) {
    await prisma.syncFile.update({
      where: { id: stale.id },
      data: { syncStatus: SyncStatus.DELETED, lastSeenAt: new Date() },
    });
    return;
  }
  await prisma.syncFile.delete({ where: { id: stale.id } });
}

async function applyMoved(
  userId: string,
  existingId: string,
  existingPath: string,
  remote: RemoteFile,
  now: Date
): Promise<"unchanged" | "modified"> {
  const meta = remoteMetaFromFile(remote);
  const existing = await prisma.syncFile.findUnique({ where: { id: existingId } });
  if (!existing) return "unchanged";

  const changed = hasRemoteMetadataChanged(existing, remote);
  await clearPathCollision(userId, remote.path, existingId);

  await prisma.syncFile.update({
    where: { id: existingId },
    data: {
      ...metadataPatchFromRemote(meta, now),
      previousRemotePath: existingPath,
      remotePath: remote.path,
      errorMessage: changed ? null : existing.errorMessage,
    },
  });

  return changed ? "modified" : "unchanged";
}

export function parseDeltaSyncPayload(raw: string | null): DeltaSyncPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rootPath =
      typeof parsed.rootPath === "string" ? parsed.rootPath : "/";
    const reconcileOnly = parsed.reconcileOnly === true;
    if (reconcileOnly) {
      return {
        rootPath,
        limit: 0,
        reconcileOnly: true,
        preferQueue: false,
        forceWalk: true,
      };
    }
    const explicit =
      parsed.limit != null && parsed.limit !== ""
        ? Number(parsed.limit)
        : undefined;
    const limit = effectiveIngestLimit(explicit);
    return {
      rootPath,
      limit,
      reconcileOnly: false,
      preferQueue: parsed.preferQueue === true,
      forceWalk: parsed.forceWalk === true,
    };
  } catch {
    return null;
  }
}

async function enqueueIngestFromDelta(
  userId: string,
  parentJobId: string,
  paths: string[],
  metaByPath: Map<string, RemoteMeta>,
  skippedBeforeIngest: number
): Promise<string | null> {
  if (paths.length === 0) return null;
  const ingestJob = await prisma.scanJob.create({
    data: {
      status: ScanJobStatus.PENDING,
      triggeredById: userId,
      jobType: "ingest_paths",
      selectedPaths: serializeIngestPathsPayload(
        paths,
        metaByPath,
        skippedBeforeIngest,
        parentJobId
      ),
    },
  });
  await enqueueScanJob(ingestJob.id);
  return ingestJob.id;
}

/**
 * Phase 2: list cloud PDFs with fileId, reconcile moves/deletes, ingest NEW/MODIFIED.
 * Supports prefer-queue fast path (E) and early ingest while discovery continues (B).
 */
export async function runDeltaSyncJob(jobId: string): Promise<void> {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Scan job ${jobId} not found`);
  if (job.status === ScanJobStatus.CANCELLED) return;

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

  const userId = job.triggeredById;
  const payload = parseDeltaSyncPayload(job.selectedPaths);
  if (!payload) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: "Payload delta_sync tidak valid",
        completedAt: new Date(),
      },
    });
    return;
  }

  const claimed = await claimJobRunning(jobId, {
    processedFiles: 0,
    phase: "starting",
    currentFile: null,
  });
  if (!claimed) return;

  const creds = await getUserCloudCredentials(userId);
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

  const client = createWebDavClient(creds.url, creds.username, creds.password);
  const rootPrefix = normalizeRootPath(payload.rootPath);
  const now = new Date();

  const ingestLimit = payload.reconcileOnly ? 0 : payload.limit;
  const ingestCapped =
    !payload.reconcileOnly &&
    ingestLimit > 0 &&
    ingestLimit < SYNC_NO_LIMIT / 2;
  // Interval / manual walk: skip unchanged folders. Weekly reconcile: list all.
  const enableFolderSkip = !payload.reconcileOnly;

  try {
    // --- Chase: drain DISCOVERED only (one cloud walk per auto-scan interval) ---
    if (
      !payload.reconcileOnly &&
      ingestLimit > 0 &&
      shouldDrainQueueOnly({
        preferQueue: payload.preferQueue === true,
        forceWalk: payload.forceWalk === true,
      })
    ) {
      const pendingCount = await countDiscoveredPending(userId, rootPrefix);
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          phase: "queue",
          currentFile: `${pendingCount} antrian`,
        },
      });

      if (pendingCount === 0) {
        console.log(
          `[delta ${jobId}] antrian kosong; tunggu interval auto-scan berikutnya`
        );
        await prisma.scanJob.update({
          where: { id: jobId },
          data: {
            status: ScanJobStatus.COMPLETED,
            completedAt: new Date(),
            phase: "done",
            currentFile: null,
            errorMessage: "Antrian kosong; tunggu interval sync berikutnya",
          },
        });
        return;
      }

      const { paths, metaByPath } = await takeDiscoveredBatch(
        userId,
        rootPrefix,
        ingestLimit
      );
      const remaining = Math.max(0, pendingCount - paths.length);
      console.log(
        `[delta ${jobId}] queue-only ingest=${paths.length} remaining≈${remaining}`
      );

      if (paths.length === 0) {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: {
            status: ScanJobStatus.COMPLETED,
            completedAt: new Date(),
            phase: "done",
            errorMessage: "Antrian kosong",
          },
        });
        return;
      }

      const ingestJobId = await enqueueIngestFromDelta(
        userId,
        jobId,
        paths,
        metaByPath,
        0
      );
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.COMPLETED,
          completedAt: new Date(),
          totalFiles: paths.length,
          processedFiles: 0,
          phase: "done",
          currentFile: null,
          errorMessage:
            remaining > 0
              ? `Antrian: ingest ${ingestJobId}; sisa ~${remaining} file`
              : `Antrian: ingest ${ingestJobId}`,
        },
      });
      await invalidateAfterScanJob(
        userId,
        job.selectedPaths,
        [payload.rootPath, ...paths],
        creds
      );
      return;
    }

    await prisma.scanJob.update({
      where: { id: jobId },
      data: { phase: "discovering", currentFile: null },
    });

    const folderSnapshots = await loadFolderSnapshots(userId, rootPrefix);

    const existingRows = await prisma.syncFile.findMany({
      where: {
        userId,
        syncStatus: { not: SyncStatus.DELETED },
        ...(rootPrefix
          ? {
              OR: [
                { remotePath: rootPrefix },
                { remotePath: { startsWith: `${rootPrefix}/` } },
              ],
            }
          : {}),
      },
    });

    const byPath = new Map(existingRows.map((r) => [r.remotePath, r]));
    const byFileId = new Map<string, ExistingRow>();
    for (const row of existingRows) {
      if (row.remoteFileId) byFileId.set(row.remoteFileId, row);
    }

    const seenIds = new Set<string>();
    const metaByPath = new Map<string, RemoteMeta>();
    const earlyBatch: string[] = [];
    const overflowMetas: RemoteMeta[] = [];
    let earlyIngestId: string | null = null;
    let moved = 0;
    let unchanged = 0;
    let needsIngestTotal = 0;

    let classifyChain: Promise<void> = Promise.resolve();
    const withClassify = (fn: () => Promise<void>) => {
      const run = classifyChain.then(fn, fn);
      classifyChain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    };

    const maybeStartEarlyIngest = async () => {
      if (payload.reconcileOnly || ingestLimit <= 0) return;
      if (earlyIngestId) return;
      if (ingestLimit >= SYNC_NO_LIMIT / 2) return;
      if (earlyBatch.length < ingestLimit) return;

      const paths = earlyBatch.splice(0, ingestLimit);
      const batchMeta = new Map<string, RemoteMeta>();
      for (const p of paths) {
        const m = metaByPath.get(p);
        if (m) batchMeta.set(p, m);
      }
      earlyIngestId = await enqueueIngestFromDelta(
        userId,
        jobId,
        paths,
        batchMeta,
        unchanged
      );
      console.log(
        `[delta ${jobId}] early ingest ${earlyIngestId} (${paths.length}) while discovering`
      );
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          phase: "discovering",
          currentFile: `ingest ${earlyIngestId?.slice(0, 8)}…`,
          totalFiles: paths.length,
        },
      });
    };

    const enqueueNeed = async (path: string, meta: RemoteMeta) => {
      needsIngestTotal++;
      if (payload.reconcileOnly || ingestLimit <= 0) return;
      if (!earlyIngestId) {
        earlyBatch.push(path);
        await maybeStartEarlyIngest();
      } else {
        overflowMetas.push(meta);
      }
    };

    const classifyRemote = async (remote: RemoteFile) => {
      if (!pathUnderRoot(remote.path, rootPrefix)) return;
      const meta = remoteMetaFromFile(remote);
      metaByPath.set(remote.path, meta);

      let existing =
        remote.fileId ? byFileId.get(remote.fileId) : undefined;
      if (!existing) {
        existing = byPath.get(remote.path);
      }

      if (existing) {
        seenIds.add(existing.id);
        if (remote.fileId && !existing.remoteFileId) {
          await prisma.syncFile.update({
            where: { id: existing.id },
            data: { remoteFileId: remote.fileId },
          });
          byFileId.set(remote.fileId, {
            ...existing,
            remoteFileId: remote.fileId,
          });
        }

        if (existing.remotePath !== remote.path) {
          const outcome = await applyMoved(
            userId,
            existing.id,
            existing.remotePath,
            remote,
            now
          );
          moved++;
          byPath.delete(existing.remotePath);
          byPath.set(remote.path, {
            ...existing,
            remotePath: remote.path,
          });
          if (outcome === "modified") {
            await enqueueNeed(remote.path, meta);
          } else {
            unchanged++;
          }
          return;
        }

        if (
          existing.syncStatus === SyncStatus.DOWNLOADING ||
          existing.syncStatus === SyncStatus.OCR_PENDING
        ) {
          await prisma.syncFile.update({
            where: { id: existing.id },
            data: metadataPatchFromRemote(meta, now),
          });
          return;
        }

        if (
          isDoneSyncStatus(existing.syncStatus) &&
          !hasRemoteMetadataChanged(existing, remote)
        ) {
          await prisma.syncFile.update({
            where: { id: existing.id },
            data: metadataPatchFromRemote(meta, now),
          });
          unchanged++;
          return;
        }

        if (
          existing.syncStatus === SyncStatus.FAILED ||
          existing.syncStatus === SyncStatus.DISCOVERED ||
          existing.syncStatus === SyncStatus.QUEUED ||
          hasRemoteMetadataChanged(existing, remote)
        ) {
          await enqueueNeed(remote.path, meta);
          return;
        }

        await prisma.syncFile.update({
          where: { id: existing.id },
          data: metadataPatchFromRemote(meta, now),
        });
        unchanged++;
        return;
      }

      await enqueueNeed(remote.path, meta);
    };

    const discoveryGate = async () => {
      const state = await waitIfPaused(jobId);
      return state === "cancelled";
    };

    const listed = await client.listAllPdfFiles({
      rootPath: payload.rootPath,
      shouldAbort: discoveryGate,
      shouldSkipDir: !enableFolderSkip
        ? () => false
        : (dirPath, dirLm, dirEtag) => {
            const skip = shouldSkipFolderListing(
              folderSnapshots.get(dirPath),
              dirLm,
              dirEtag
            );
            if (skip) {
              // Don't mark children DELETED when we intentionally skip the folder.
              for (const row of existingRows) {
                if (
                  row.remotePath === dirPath ||
                  row.remotePath.startsWith(`${dirPath}/`)
                ) {
                  seenIds.add(row.id);
                }
              }
            }
            return skip;
          },
      onDirListed: async (dirPath, dirLm, dirEtag) => {
        await upsertFolderSnapshot(userId, dirPath, dirLm, dirEtag);
        folderSnapshots.set(dirPath, {
          dirLastModified: dirLm,
          dirEtag,
        });
      },
      onFileFound: (file) => withClassify(() => classifyRemote(file)),
      onProgress: async (found, meta) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: {
            processedFiles: found,
            phase: "discovering",
            currentFile:
              meta?.dirsVisited != null
                ? earlyIngestId
                  ? `${meta.dirsVisited} folder · download jalan`
                  : `${meta.dirsVisited} folder`
                : null,
          },
        });
      },
    });

    await classifyChain;
    await flushPendingFolderSnapshots();

    if (await isCancelled(jobId)) {
      const abandoned = await abandonInFlightSyncFiles(
        userId,
        "Dibatalkan saat discovery"
      );
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage:
            abandoned > 0
              ? `Cancelled during discovery (${abandoned} file dibersihkan)`
              : "Cancelled during discovery",
          phase: "done",
        },
      });
      return;
    }

    // DELETE only after full walk completes (never on fast-path / mid-walk).
    let deleted = 0;
    for (const row of existingRows) {
      if (seenIds.has(row.id)) continue;
      if (!pathUnderRoot(row.remotePath, rootPrefix)) continue;
      await prisma.syncFile.update({
        where: { id: row.id },
        data: {
          syncStatus: SyncStatus.DELETED,
          lastSeenAt: now,
          errorMessage: null,
        },
      });
      deleted++;
    }

    // Leftover early batch (never reached limit or unlimited)
    if (!earlyIngestId && earlyBatch.length > 0 && !payload.reconcileOnly) {
      const paths =
        ingestLimit >= SYNC_NO_LIMIT / 2
          ? [...earlyBatch]
          : earlyBatch.slice(0, ingestLimit);
      const overflowPaths = earlyBatch.slice(paths.length);
      for (const p of overflowPaths) {
        const m = metaByPath.get(p);
        if (m) overflowMetas.push(m);
      }
      earlyIngestId = await enqueueIngestFromDelta(
        userId,
        jobId,
        paths,
        metaByPath,
        unchanged
      );
      earlyBatch.length = 0;
    } else if (earlyIngestId && earlyBatch.length > 0) {
      for (const p of earlyBatch) {
        const m = metaByPath.get(p);
        if (m) overflowMetas.push(m);
      }
      earlyBatch.length = 0;
    }

    const overflowSaved = await upsertDiscoveredOverflow(
      userId,
      overflowMetas,
      now
    );

    const cloudFiles = listed.files.filter((f) =>
      pathUnderRoot(f.path, rootPrefix)
    );

    await prisma.user.update({
      where: { id: userId },
      data: {
        lastDiscoveryAt: now,
        lastScanCloudFiles: cloudFiles.length,
        lastScanNeedsIngest: needsIngestTotal,
        lastScanUnchanged: unchanged,
      },
    });

    console.log(
      `[delta ${jobId}] cloud=${cloudFiles.length} needs=${needsIngestTotal} early=${earlyIngestId ?? "-"} overflow=${overflowSaved} moved=${moved} unchanged=${unchanged} deleted=${deleted}`
    );

    const scanSummary = `Scan: ${cloudFiles.length} ketemu, ${needsIngestTotal} perlu unduh/OCR, ${unchanged} skip (sudah sama)${
      overflowSaved > 0 ? `, ${overflowSaved} antrian` : ""
    }`;

    if (!earlyIngestId) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.COMPLETED,
          completedAt: new Date(),
          skippedFiles: unchanged,
          totalFiles: needsIngestTotal,
          processedFiles: cloudFiles.length,
          newFiles: overflowSaved,
          phase: "done",
          currentFile: null,
          errorMessage: payload.reconcileOnly
            ? "Reconcile selesai (tanpa ingest)"
            : scanSummary,
        },
      });
    } else {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.COMPLETED,
          completedAt: new Date(),
          skippedFiles: unchanged,
          totalFiles: needsIngestTotal,
          processedFiles: cloudFiles.length,
          newFiles: overflowSaved,
          phase: "done",
          currentFile: null,
          errorMessage: `${scanSummary}. Ingest: ${earlyIngestId}`,
        },
      });
    }

    await invalidateAfterScanJob(userId, job.selectedPaths, [
      payload.rootPath,
    ], creds);
  } catch (err) {
    if (err instanceof ScanAbortedError || (await isCancelled(jobId))) {
      const abandoned = await abandonInFlightSyncFiles(
        userId,
        "Dibatalkan selama delta sync"
      );
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage:
            abandoned > 0
              ? `Cancelled (${abandoned} file dibersihkan)`
              : "Cancelled",
          phase: "done",
        },
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Delta sync failed";
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: message,
        completedAt: new Date(),
        phase: "done",
      },
    });
    throw err;
  }
}
