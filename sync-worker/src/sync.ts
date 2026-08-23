import { ScanJobStatus, SyncStatus } from "@prisma/client";
import { prisma, getUserCloudCredentials } from "./db.js";
import { createWebDavClient, ScanAbortedError, moveTempToConsume, discardTemp } from "./webdav.js";
import { findPaperlessDocumentByChecksum } from "./paperless.js";

/** 0 = unlimited. Applies to folder/all/selected/newest ceilings. */
function scanMaxFiles(): number {
  const n = Number(process.env.SCAN_MAX_FILES ?? "50");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}

function stuckSyncMinutes(): number {
  const n = Number(process.env.STUCK_SYNC_MINUTES ?? "60");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}

function downloadConcurrency(): number {
  const n = Number(process.env.WEBDAV_DOWNLOAD_CONCURRENCY ?? "2");
  if (!Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(1, Math.floor(n)));
}

function normalizeFavoritePath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/** Mark favorite folder as synced (delta "new since" window). */
async function touchFavoriteSyncedAt(
  userId: string,
  rootPath: string
): Promise<void> {
  const path = normalizeFavoritePath(rootPath);
  await prisma.cloudFavorite.updateMany({
    where: { userId, path },
    data: { lastSyncedAt: new Date() },
  });
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
      last = err;
      if (i < attempts - 1) {
        const waitMs = 1000 * (i + 1);
        console.warn(
          `[retry] ${label} attempt ${i + 1}/${attempts} failed, wait ${waitMs}ms:`,
          err instanceof Error ? err.message : err
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw last;
}

/** Mark in-flight (not yet submitted to OCR) files as failed after cancel/stuck. */
export async function abandonInFlightSyncFiles(
  userId: string,
  reason: string
): Promise<number> {
  const result = await prisma.syncFile.updateMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.QUEUED, SyncStatus.DOWNLOADING] },
    },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage: reason,
    },
  });
  return result.count;
}

function hasFileChanged(
  existing: {
    etag: string | null;
    lastModified: Date | null;
    fileSize: bigint | null;
  },
  remote: { etag: string | null; lastModified: Date | null; size: number }
): boolean {
  if (existing.etag && remote.etag && existing.etag !== remote.etag) {
    return true;
  }
  if (
    existing.lastModified &&
    remote.lastModified &&
    existing.lastModified.getTime() !== remote.lastModified.getTime()
  ) {
    return true;
  }
  if (existing.fileSize !== null && BigInt(remote.size) !== existing.fileSize) {
    return true;
  }
  return false;
}

async function isCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.scanJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === ScanJobStatus.CANCELLED;
}

async function waitIfPaused(jobId: string): Promise<"ok" | "cancelled"> {
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

/** Claim job for work without resurrecting CANCELLED/COMPLETED/FAILED. */
async function claimJobRunning(
  jobId: string,
  data: {
    phase?: string;
    processedFiles?: number;
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

function pathUnderRoot(remotePath: string, rootPrefix: string | null): boolean {
  if (!rootPrefix) return true;
  return remotePath === rootPrefix || remotePath.startsWith(`${rootPrefix}/`);
}

/** Statuses that must not be re-selected for ingest. FAILED stays eligible. */
const BLOCK_REINGEST_STATUSES: SyncStatus[] = [
  SyncStatus.OCR_DONE,
  SyncStatus.SKIPPED,
  SyncStatus.OCR_PENDING,
  SyncStatus.QUEUED,
  SyncStatus.DOWNLOADING,
];

const ACTIVE_JOB_STATUSES = [
  ScanJobStatus.PENDING,
  ScanJobStatus.RUNNING,
  ScanJobStatus.PAUSED,
] as const;

export async function runScanJob(jobId: string): Promise<void> {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Scan job ${jobId} not found`);
  if (job.status === ScanJobStatus.CANCELLED) return;

  if (
    job.jobType === "ingest_selected" ||
    job.jobType === "ingest_newest" ||
    job.jobType === "ingest_all"
  ) {
    await runIngestSelectedJob(jobId);
    return;
  }

  await runFullScanJob(jobId);
}

type IngestPayload =
  | { mode: "paths"; paths: string[] }
  | { mode: "newest"; rootPath: string; limit: number }
  | { mode: "all"; rootPath: string; limit: number | null };

function parseIngestPayload(
  jobType: string,
  raw: string | null
): IngestPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return { mode: "paths", paths: parsed.filter((p) => typeof p === "string") };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (obj.mode === "newest") {
        return {
          mode: "newest",
          rootPath: typeof obj.rootPath === "string" ? obj.rootPath : "/",
          limit: Math.max(1, Number(obj.limit) || 10),
        };
      }
      if (obj.mode === "all") {
        const lim =
          obj.limit == null || obj.limit === ""
            ? null
            : Math.max(1, Number(obj.limit) || 0);
        return {
          mode: "all",
          rootPath: typeof obj.rootPath === "string" ? obj.rootPath : "/",
          limit: lim && lim > 0 ? lim : null,
        };
      }
      if (obj.mode === "paths" && Array.isArray(obj.paths)) {
        return {
          mode: "paths",
          paths: obj.paths.filter((p): p is string => typeof p === "string"),
        };
      }
    }
  } catch {
    // fallthrough
  }
  if (jobType === "ingest_newest") {
    return { mode: "newest", rootPath: "/", limit: 10 };
  }
  if (jobType === "ingest_all") {
    return { mode: "all", rootPath: "/", limit: null };
  }
  return null;
}

function applyFileCap(paths: string[], preferredLimit: number | null): string[] {
  const envMax = scanMaxFiles();
  let cap = preferredLimit;
  if (envMax > 0) {
    cap = cap == null || cap <= 0 ? envMax : Math.min(cap, envMax);
  }
  if (cap == null || cap <= 0) return paths;
  if (paths.length > cap) {
    console.log(`[ingest] capping ${paths.length} → ${cap} (SCAN_MAX_FILES / batch limit)`);
    return paths.slice(0, cap);
  }
  return paths;
}

async function runIngestSelectedJob(jobId: string): Promise<void> {
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
  const payload = parseIngestPayload(job.jobType, job.selectedPaths);

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
  let paths: string[] = [];

  try {
    if (!payload) {
      throw new Error("Payload ingest tidak valid");
    }

    if (payload.mode === "paths") {
      paths = applyFileCap(payload.paths, null);
    } else {
      console.log(
        `[ingest ${jobId}] discovering PDFs under ${payload.rootPath} (${payload.mode})...`
      );
      await prisma.scanJob.update({
        where: { id: jobId },
        data: { phase: "discovering", currentFile: null },
      });

      const rootPrefix =
        !payload.rootPath || payload.rootPath === "/"
          ? null
          : payload.rootPath.replace(/\/$/, "");

      // Preload paths that must not be re-ingested (done or still in flight).
      const existing = await prisma.syncFile.findMany({
        where: {
          userId,
          syncStatus: { in: BLOCK_REINGEST_STATUSES },
          ...(rootPrefix
            ? {
                OR: [
                  { remotePath: rootPrefix },
                  { remotePath: { startsWith: `${rootPrefix}/` } },
                ],
              }
            : {}),
        },
        select: { remotePath: true },
      });
      const doneSet = new Set(
        existing
          .map((e) => e.remotePath)
          .filter((p) => pathUnderRoot(p, rootPrefix))
      );

      const envMax = scanMaxFiles();
      const wantLimit =
        payload.mode === "newest"
          ? payload.limit
          : payload.limit != null && payload.limit > 0
            ? payload.limit
            : envMax > 0
              ? envMax
              : null;

      const onDiscoverProgress = async (
        found: number,
        meta?: { pending?: number; dirsVisited?: number; earlyStop?: boolean }
      ) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: {
            processedFiles: meta?.pending ?? found,
            phase: "discovering",
            currentFile:
              meta?.dirsVisited != null
                ? `${meta.dirsVisited} folder${meta.earlyStop ? " (cukup)" : ""}`
                : null,
          },
        });
      };

      const discoveryGate = async () => {
        const state = await waitIfPaused(jobId);
        return state === "cancelled";
      };

      let all: Awaited<ReturnType<typeof client.listAllPdfFiles>>["files"];
      let skippedDirCount = 0;

      if (wantLimit != null) {
        const listed = await client.listNewestPdfFiles({
          rootPath: payload.rootPath,
          limit: wantLimit,
          excludePaths: doneSet,
          shouldAbort: discoveryGate,
          onProgress: onDiscoverProgress,
        });
        all = listed.files;
        skippedDirCount = listed.skippedDirs.length;
        if (listed.earlyStop) {
          console.log(
            `[ingest ${jobId}] newest early-stop after ${listed.dirsVisited} dirs`
          );
        }
      } else {
        const listed = await client.listAllPdfFiles({
          rootPath: payload.rootPath,
          shouldAbort: discoveryGate,
          onProgress: onDiscoverProgress,
        });
        all = listed.files;
        skippedDirCount = listed.skippedDirs.length;
      }

      if (skippedDirCount > 0) {
        console.warn(
          `[ingest ${jobId}] skipped ${skippedDirCount} cloud folders during discovery`
        );
      }

      if (await isCancelled(jobId)) {
        const abandoned = await abandonInFlightSyncFiles(
          userId,
          "Dibatalkan sebelum dikirim ke OCR"
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
            currentFile: null,
          },
        });
        return;
      }

      const pending = all.filter((f) => !doneSet.has(f.path));

      if (payload.mode === "newest") {
        paths = pending.slice(0, payload.limit).map((f) => f.path);
      } else {
        paths = pending.map((f) => f.path);
      }

      paths = applyFileCap(
        paths,
        payload.mode === "newest" ? payload.limit : payload.limit
      );

      console.log(
        `[ingest ${jobId}] found ${all.length} candidates, ${pending.length} pending, taking ${paths.length}`
      );
    }

    if (paths.length === 0) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.COMPLETED,
          completedAt: new Date(),
          totalFiles: 0,
          processedFiles: 0,
          errorMessage: "Tidak ada PDF baru untuk diambil",
          phase: "done",
          currentFile: null,
        },
      });
      if (
        payload &&
        (payload.mode === "newest" || payload.mode === "all")
      ) {
        await touchFavoriteSyncedAt(userId, payload.rootPath);
      }
      return;
    }

    for (const remotePath of paths) {
      const fileName =
        remotePath.split("/").filter(Boolean).pop() ?? remotePath;
      await prisma.syncFile.upsert({
        where: { userId_remotePath: { userId, remotePath } },
        create: {
          userId,
          remotePath,
          fileName,
          syncStatus: SyncStatus.QUEUED,
        },
        update: {
          syncStatus: SyncStatus.QUEUED,
          errorMessage: null,
        },
      });
    }

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        totalFiles: paths.length,
        processedFiles: 0,
        phase: "downloading",
        currentFile: null,
      },
    });
  } catch (err) {
    if (err instanceof ScanAbortedError || (await isCancelled(jobId))) {
      const abandoned = await abandonInFlightSyncFiles(
        userId,
        "Dibatalkan sebelum dikirim ke OCR"
      );
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
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
    const message = err instanceof Error ? err.message : "Discovery failed";
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: message,
        completedAt: new Date(),
        phase: "done",
        currentFile: null,
      },
    });
    throw err;
  }

  let processed = 0;
  let skipped = 0;
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

  const ingestOnePath = async (remotePath: string): Promise<void> => {
    if (cancelledMid || sharedAbort.signal.aborted) return;

    const pauseState = await waitIfPaused(jobId);
    if (pauseState === "cancelled" || (await isCancelled(jobId))) {
      markCancelledLocal();
      return;
    }

    const fileName =
      remotePath.split("/").filter(Boolean).pop() ?? remotePath;
    let tempPath: string | null = null;

    try {
      await prisma.scanJob.updateMany({
        where: {
          id: jobId,
          status: { in: [ScanJobStatus.RUNNING, ScanJobStatus.PAUSED] },
        },
        data: { phase: "downloading", currentFile: fileName },
      });

      await prisma.syncFile.upsert({
        where: { userId_remotePath: { userId, remotePath } },
        create: {
          userId,
          remotePath,
          fileName,
          syncStatus: SyncStatus.DOWNLOADING,
        },
        update: {
          syncStatus: SyncStatus.DOWNLOADING,
          errorMessage: null,
        },
      });

      let downloaded: { tempPath: string; hash: string; size: number };
      downloaded = await withRetries(
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
      await prisma.syncFile.updateMany({
        where: { userId, remotePath },
        data: { syncStatus: SyncStatus.FAILED, errorMessage: message },
      });
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
          await ingestOnePath(remotePath);
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

    if (payload && (payload.mode === "newest" || payload.mode === "all")) {
      await touchFavoriteSyncedAt(userId, payload.rootPath);
    }
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
              ? `Cancelled by user (${abandoned} file antre dibersihkan)`
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

async function runFullScanJob(jobId: string): Promise<void> {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`Scan job ${jobId} not found`);
  if (job.status === ScanJobStatus.CANCELLED) return;

  if (!job.triggeredById) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: "Scan job has no user: cannot load Bappenas credentials",
        completedAt: new Date(),
      },
    });
    return;
  }

  const userId = job.triggeredById;

  const claimed = await claimJobRunning(jobId);
  if (!claimed) return;

  const creds = await getUserCloudCredentials(userId);
  if (!creds) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage:
          "Kredensial Cloud Bappenas belum diisi. Lengkapi di Profil.",
        completedAt: new Date(),
      },
    });
    return;
  }

  const client = createWebDavClient(creds.url, creds.username, creds.password);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let newFiles = 0;

  try {
    console.log(`[scan ${jobId}] discovering PDFs on Bappenas...`);
    const listed = await client.listAllPdfFiles({
      shouldAbort: () => isCancelled(jobId),
      onProgress: async (found) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: { processedFiles: found },
        });
      },
    });
    const allRemoteFiles = listed.files;
    if (listed.skippedDirs.length > 0) {
      console.warn(
        `[scan ${jobId}] skipped ${listed.skippedDirs.length} cloud folders`
      );
    }

    if (await isCancelled(jobId)) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: "Cancelled during discovery",
        },
      });
      return;
    }

    const maxFiles = scanMaxFiles();
    const remoteFiles =
      maxFiles > 0 ? allRemoteFiles.slice(0, maxFiles) : allRemoteFiles;

    if (maxFiles > 0 && allRemoteFiles.length > maxFiles) {
      console.log(
        `[scan] limiting ${allRemoteFiles.length} PDFs → ${maxFiles} (SCAN_MAX_FILES)`
      );
    }

    await prisma.scanJob.update({
      where: { id: jobId },
      data: { totalFiles: remoteFiles.length, processedFiles: 0 },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { lastDiscoveryAt: new Date() },
    });

    for (const remote of remoteFiles) {
      const pauseState = await waitIfPaused(jobId);
      if (pauseState === "cancelled" || (await isCancelled(jobId))) {
        const abandoned = await abandonInFlightSyncFiles(
          userId,
          "Dibatalkan sebelum dikirim ke OCR"
        );
        await prisma.scanJob.update({
          where: { id: jobId },
          data: {
            status: ScanJobStatus.CANCELLED,
            completedAt: new Date(),
            processedFiles: processed,
            skippedFiles: skipped,
            failedFiles: failed + abandoned,
            newFiles,
          },
        });
        return;
      }

      try {
        const existing = await prisma.syncFile.findUnique({
          where: {
            userId_remotePath: { userId, remotePath: remote.path },
          },
        });

        if (
          existing &&
          (existing.syncStatus === SyncStatus.OCR_DONE ||
            existing.syncStatus === SyncStatus.SKIPPED) &&
          !hasFileChanged(existing, remote)
        ) {
          skipped++;
          await prisma.scanJob.update({
            where: { id: jobId },
            data: { processedFiles: ++processed, skippedFiles: skipped },
          });
          continue;
        }

        await prisma.syncFile.upsert({
          where: {
            userId_remotePath: { userId, remotePath: remote.path },
          },
          create: {
            userId,
            remotePath: remote.path,
            fileName: remote.basename,
            etag: remote.etag,
            lastModified: remote.lastModified,
            fileSize: BigInt(remote.size),
            mimeType: remote.mimeType,
            syncStatus: SyncStatus.DOWNLOADING,
          },
          update: {
            etag: remote.etag,
            lastModified: remote.lastModified,
            fileSize: BigInt(remote.size),
            syncStatus: SyncStatus.DOWNLOADING,
            errorMessage: null,
          },
        });

        const ac = new AbortController();
        const cancelPoll = setInterval(() => {
          void isCancelled(jobId).then((c) => {
            if (c) ac.abort();
          });
        }, 800);
        let downloaded: { tempPath: string; hash: string; size: number };
        try {
          downloaded = await withRetries(
            () =>
              client.downloadToTemp(remote.path, { signal: ac.signal }),
            3,
            `download ${remote.basename}`
          );
        } finally {
          clearInterval(cancelPoll);
        }
        const tempPath = downloaded.tempPath;
        const hash = downloaded.hash;

        // Dedup OCR: reuse Paperless doc if any user already OCR'd this hash
        const duplicateByHash = await prisma.syncFile.findFirst({
          where: {
            contentHash: hash,
            syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
            paperlessDocumentId: { not: null },
            NOT: { userId, remotePath: remote.path },
          },
        });

        if (duplicateByHash?.paperlessDocumentId) {
          await discardTemp(tempPath);
          await prisma.syncFile.update({
            where: {
              userId_remotePath: { userId, remotePath: remote.path },
            },
            data: {
              contentHash: hash,
              fileSize: BigInt(downloaded.size),
              syncStatus: SyncStatus.SKIPPED,
              paperlessDocumentId: duplicateByHash.paperlessDocumentId,
              lastSyncedAt: new Date(),
            },
          });
          skipped++;
          await prisma.scanJob.update({
            where: { id: jobId },
            data: { processedFiles: ++processed, skippedFiles: skipped },
          });
          continue;
        }

        const existingPaperlessId = await findPaperlessDocumentByChecksum(hash);
        if (existingPaperlessId) {
          await discardTemp(tempPath);
          await prisma.syncFile.update({
            where: {
              userId_remotePath: { userId, remotePath: remote.path },
            },
            data: {
              contentHash: hash,
              fileSize: BigInt(downloaded.size),
              syncStatus: SyncStatus.OCR_DONE,
              paperlessDocumentId: existingPaperlessId,
              lastSyncedAt: new Date(),
            },
          });
          skipped++;
          await prisma.scanJob.update({
            where: { id: jobId },
            data: { processedFiles: ++processed, skippedFiles: skipped },
          });
          continue;
        }

        await prisma.syncFile.update({
          where: {
            userId_remotePath: { userId, remotePath: remote.path },
          },
          data: { syncStatus: SyncStatus.QUEUED },
        });

        await withRetries(
          () => moveTempToConsume(tempPath, remote.basename),
          3,
          `submit ${remote.basename}`
        );

        await prisma.syncFile.update({
          where: {
            userId_remotePath: { userId, remotePath: remote.path },
          },
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
        await prisma.scanJob.update({
          where: { id: jobId },
          data: { processedFiles: processed, newFiles },
        });
      } catch (err) {
        if (err instanceof ScanAbortedError || (await isCancelled(jobId))) {
          throw err instanceof ScanAbortedError
            ? err
            : new ScanAbortedError();
        }
        failed++;
        const message = err instanceof Error ? err.message : "Unknown error";
        await prisma.syncFile.updateMany({
          where: { userId, remotePath: remote.path },
          data: { syncStatus: SyncStatus.FAILED, errorMessage: message },
        });
        await prisma.scanJob.update({
          where: { id: jobId },
          data: { processedFiles: ++processed, failedFiles: failed },
        });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { lastSyncAt: new Date() },
    });

    const current = await prisma.scanJob.findUnique({ where: { id: jobId } });
    if (current?.status === ScanJobStatus.CANCELLED) return;

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.COMPLETED,
        completedAt: new Date(),
        processedFiles: processed,
        skippedFiles: skipped,
        failedFiles: failed,
        newFiles,
      },
    });
  } catch (err) {
    if (err instanceof ScanAbortedError || (await isCancelled(jobId))) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: ScanJobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: "Cancelled by user",
          processedFiles: processed,
          skippedFiles: skipped,
          failedFiles: failed,
          newFiles,
        },
      });
      console.log(`[scan ${jobId}] cancelled`);
      return;
    }

    const message = err instanceof Error ? err.message : "Scan failed";
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: ScanJobStatus.FAILED,
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

const PAPERLESS_TOKEN = process.env.PAPERLESS_TOKEN ?? "";
const OCR_TIMEOUT_MIN = Number(process.env.OCR_PENDING_TIMEOUT_MINUTES ?? 180);
const RECONCILE_BATCH = Number(process.env.OCR_RECONCILE_BATCH ?? "200") || 200;

export async function reconcileOcrStatus(): Promise<{
  done: number;
  timedOut: number;
}> {
  let done = 0;
  let timedOut = 0;

  const pending = await prisma.syncFile.findMany({
    where: { syncStatus: SyncStatus.OCR_PENDING },
    take: Math.min(500, Math.max(50, RECONCILE_BATCH)),
    orderBy: { updatedAt: "asc" },
  });

  if (pending.length === 0) return { done, timedOut };

  const cutoff = new Date(Date.now() - OCR_TIMEOUT_MIN * 60 * 1000);

  for (const file of pending) {
    const pendingSince = file.ocrPendingAt ?? file.updatedAt;
    if (PAPERLESS_TOKEN && file.contentHash) {
      const docId = await findPaperlessDocumentByChecksum(file.contentHash);
      if (docId) {
        await prisma.syncFile.update({
          where: { id: file.id },
          data: {
            syncStatus: SyncStatus.OCR_DONE,
            paperlessDocumentId: docId,
            errorMessage: null,
            ocrPendingAt: null,
          },
        });
        done++;
        // Embedding runs via backfillDocumentEmbeddings (non-blocking)
        continue;
      }
    }

    if (pendingSince < cutoff) {
      await prisma.syncFile.update({
        where: { id: file.id },
        data: {
          syncStatus: SyncStatus.FAILED,
          errorMessage: `OCR timeout setelah ${OCR_TIMEOUT_MIN} menit. Dokumen belum muncul di Paperless. Coba OCR lagi.`,
        },
      });
      timedOut++;
    }
  }

  return { done, timedOut };
}

/** Clear QUEUED/DOWNLOADING left behind when no job is active for that user. */
export async function sweepStuckInFlightFiles(): Promise<number> {
  const mins = stuckSyncMinutes();
  const cutoff = new Date(Date.now() - mins * 60 * 1000);

  const activeJobs = await prisma.scanJob.findMany({
    where: {
      status: { in: [...ACTIVE_JOB_STATUSES] },
      triggeredById: { not: null },
    },
    select: { triggeredById: true },
  });
  const activeUsers = [
    ...new Set(
      activeJobs
        .map((j) => j.triggeredById)
        .filter((id): id is string => typeof id === "string")
    ),
  ];

  const result = await prisma.syncFile.updateMany({
    where: {
      syncStatus: { in: [SyncStatus.QUEUED, SyncStatus.DOWNLOADING] },
      updatedAt: { lt: cutoff },
      ...(activeUsers.length > 0 ? { userId: { notIn: activeUsers } } : {}),
    },
    data: {
      syncStatus: SyncStatus.FAILED,
      errorMessage: `Macet lebih dari ${mins} menit tanpa scan aktif. Aman untuk Coba OCR lagi.`,
    },
  });

  return result.count;
}

/**
 * @deprecated Full-tree pending count was too expensive for auto-scan.
 * Kept as a cheap DB hint (failed/queued rows), not a live WebDAV walk.
 */
export async function countPendingCloudFilesForUser(
  userId: string
): Promise<number> {
  return prisma.syncFile.count({
    where: {
      userId,
      syncStatus: {
        in: [
          SyncStatus.DISCOVERED,
          SyncStatus.QUEUED,
          SyncStatus.FAILED,
          SyncStatus.DOWNLOADING,
        ],
      },
    },
  });
}

export async function hasActiveScanJobForUser(userId: string): Promise<boolean> {
  const active = await prisma.scanJob.findFirst({
    where: {
      triggeredById: userId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
  });
  return !!active;
}
