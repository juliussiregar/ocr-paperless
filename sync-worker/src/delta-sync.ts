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
import {
  runIngestPathsForJob,
  serializeIngestPathsPayload,
} from "./ingest-batch.js";
import { enqueueScanJob } from "./scan-queues.js";
import { invalidateAfterScanJob } from "./listing-cache.js";
import {
  effectiveIngestLimit,
  isUnlimitedSyncBatch,
  SYNC_NO_LIMIT,
} from "./sync-defaults.js";
import {
  loadFolderSnapshots,
  shouldSkipFolderListing,
  upsertFolderSnapshot,
} from "./folder-cache.js";

export type DeltaSyncPayload = {
  rootPath: string;
  limit: number;
  reconcileOnly?: boolean;
};

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
      return { rootPath, limit: 0, reconcileOnly: true };
    }
    const explicit =
      parsed.limit != null && parsed.limit !== ""
        ? Number(parsed.limit)
        : undefined;
    const limit = effectiveIngestLimit(explicit);
    return { rootPath, limit, reconcileOnly: false };
  } catch {
    return null;
  }
}

/**
 * Phase 2: list cloud PDFs with fileId, reconcile moves/deletes, ingest only NEW/MODIFIED.
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
  const fullDiscover = isUnlimitedSyncBatch() || ingestLimit >= SYNC_NO_LIMIT / 2;

  try {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: { phase: "discovering", currentFile: null },
    });

    const folderSnapshots = await loadFolderSnapshots(userId, rootPrefix);

    const discoveryGate = async () => {
      const state = await waitIfPaused(jobId);
      return state === "cancelled";
    };

    const listed = await client.listAllPdfFiles({
      rootPath: payload.rootPath,
      shouldAbort: discoveryGate,
      shouldSkipDir: fullDiscover
        ? () => false
        : (dirPath, dirLm, dirEtag) =>
            shouldSkipFolderListing(
              folderSnapshots.get(dirPath),
              dirLm,
              dirEtag
            ),
      onDirListed: async (dirPath, dirLm, dirEtag) => {
        await upsertFolderSnapshot(userId, dirPath, dirLm, dirEtag);
        folderSnapshots.set(dirPath, {
          dirLastModified: dirLm,
          dirEtag,
        });
      },
      onProgress: async (found, meta) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: {
            processedFiles: found,
            phase: "discovering",
            currentFile:
              meta?.dirsVisited != null
                ? `${meta.dirsVisited} folder`
                : null,
          },
        });
      },
    });

    const cloudFiles = listed.files.filter((f) => pathUnderRoot(f.path, rootPrefix));

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
    const byFileId = new Map<string, typeof existingRows[number]>();
    for (const row of existingRows) {
      if (row.remoteFileId) byFileId.set(row.remoteFileId, row);
    }

    const seenIds = new Set<string>();
    const pathsToIngest: string[] = [];
    const metaByPath = new Map<string, RemoteMeta>();
    let moved = 0;
    let unchanged = 0;

    for (const remote of cloudFiles) {
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
          byFileId.set(remote.fileId, { ...existing, remoteFileId: remote.fileId });
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
          if (outcome === "modified") {
            pathsToIngest.push(remote.path);
          } else {
            unchanged++;
          }
          byPath.delete(existing.remotePath);
          byPath.set(remote.path, { ...existing, remotePath: remote.path });
          continue;
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
          continue;
        }

        if (
          existing.syncStatus === SyncStatus.FAILED ||
          hasRemoteMetadataChanged(existing, remote)
        ) {
          pathsToIngest.push(remote.path);
          continue;
        }

        await prisma.syncFile.update({
          where: { id: existing.id },
          data: metadataPatchFromRemote(meta, now),
        });
        unchanged++;
        continue;
      }

      pathsToIngest.push(remote.path);
    }

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
    }

    const cappedIngest =
      ingestLimit >= SYNC_NO_LIMIT / 2
        ? pathsToIngest
        : pathsToIngest.slice(0, ingestLimit);

    console.log(
      `[delta ${jobId}] cloud=${cloudFiles.length} ingest=${cappedIngest.length}/${pathsToIngest.length} moved=${moved} unchanged=${unchanged} deleted=${existingRows.length - seenIds.size}`
    );

    await prisma.user.update({
      where: { id: userId },
      data: { lastDiscoveryAt: now },
    });

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        totalFiles: cappedIngest.length,
        processedFiles: 0,
        phase: cappedIngest.length > 0 ? "downloading" : "done",
        currentFile: null,
      },
    });

    if (cappedIngest.length === 0) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.COMPLETED,
          completedAt: new Date(),
          skippedFiles: unchanged,
          phase: "done",
          errorMessage:
            pathsToIngest.length > cappedIngest.length && ingestLimit < SYNC_NO_LIMIT / 2
              ? `${pathsToIngest.length - cappedIngest.length} file menunggu batch berikutnya`
              : payload.reconcileOnly
                ? "Reconcile selesai (tanpa ingest)"
                : null,
        },
      });
      await invalidateAfterScanJob(userId, job.selectedPaths, [
        payload.rootPath,
      ], creds);
      return;
    }

    const ingestJob = await prisma.scanJob.create({
      data: {
        status: ScanJobStatus.PENDING,
        triggeredById: userId,
        jobType: "ingest_paths",
        selectedPaths: serializeIngestPathsPayload(
          cappedIngest,
          metaByPath,
          unchanged,
          jobId
        ),
      },
    });

    await enqueueScanJob(ingestJob.id);

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.COMPLETED,
        completedAt: new Date(),
        skippedFiles: unchanged,
        totalFiles: cappedIngest.length,
        phase: "done",
        currentFile: null,
        errorMessage:
          pathsToIngest.length > cappedIngest.length && ingestLimit < SYNC_NO_LIMIT / 2
            ? `${pathsToIngest.length - cappedIngest.length} file menunggu; ingest ${ingestJob.id}`
            : `Ingest antrian: ${ingestJob.id}`,
      },
    });
    await invalidateAfterScanJob(userId, job.selectedPaths, [
      payload.rootPath,
      ...cappedIngest,
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
