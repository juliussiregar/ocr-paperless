import { createHash } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, rename, unlink } from "fs/promises";
import { join } from "path";
import { Readable } from "stream";
import { createClient, type FileStat } from "webdav";

export interface RemoteFile {
  path: string;
  basename: string;
  etag: string | null;
  lastModified: Date | null;
  size: number;
  mimeType: string | null;
}

export class ScanAbortedError extends Error {
  constructor() {
    super("SCAN_ABORTED");
    this.name = "ScanAbortedError";
  }
}

const PDF_MIME = "application/pdf";
const PDF_EXT = ".pdf";
const CONSUME_DIR = process.env.CONSUME_DIR ?? "/consume";
const SYNC_TEMP = process.env.SYNC_TEMP_DIR ?? "/tmp/sync";

function isPdfFile(item: FileStat): boolean {
  if (item.type !== "file") return false;
  const mime = item.mime ?? "";
  const name = item.basename.toLowerCase();
  return mime === PDF_MIME || name.endsWith(PDF_EXT);
}

function normalizeEtag(etag: unknown): string | null {
  if (typeof etag === "string" && etag) {
    return etag.replace(/^W\//, "").replace(/"/g, "");
  }
  return null;
}

function discoveryConcurrency(): number {
  const n = Number(process.env.WEBDAV_DISCOVERY_CONCURRENCY ?? "16");
  if (!Number.isFinite(n)) return 16;
  return Math.min(24, Math.max(1, Math.floor(n)));
}

function toRemoteFile(item: FileStat): RemoteFile {
  return {
    path: item.filename,
    basename: item.basename,
    etag: normalizeEtag(item.etag),
    lastModified: item.lastmod ? new Date(item.lastmod) : null,
    size: typeof item.size === "number" ? item.size : 0,
    mimeType: item.mime ?? PDF_MIME,
  };
}

function dirLastmodMs(item: FileStat): number {
  if (!item.lastmod) return 0;
  const t = new Date(item.lastmod).getTime();
  return Number.isFinite(t) ? t : 0;
}

function fileLastmodMs(file: RemoteFile): number {
  return file.lastModified?.getTime() ?? 0;
}

type DirTask = { path: string; lastmodMs: number };

type WalkProgress = {
  found: number;
  pending: number;
  dirsVisited: number;
  skippedDirs: number;
  earlyStop?: boolean;
};

/**
 * Parallel directory walk. For newest/limited modes, prefers recently-modified
 * folders and can stop early once top-N pending PDFs cannot be beaten by
 * remaining folders (Nextcloud folder mtime ≈ newest child activity).
 */
async function walkPdfTree(options: {
  client: ReturnType<typeof createClient>;
  rootPath: string;
  shouldAbort?: () => Promise<boolean>;
  onProgress?: (p: WalkProgress) => void | Promise<void>;
  /** If set, stop once we have this many PDFs not in excludePaths (newest-first). */
  newestLimit?: number;
  excludePaths?: Set<string>;
}): Promise<{
  files: RemoteFile[];
  skippedDirs: string[];
  earlyStop: boolean;
  dirsVisited: number;
}> {
  const concurrency = discoveryConcurrency();
  const start =
    !options.rootPath || options.rootPath === "/"
      ? "/"
      : options.rootPath.replace(/\/$/, "") || "/";

  const results: RemoteFile[] = [];
  const skippedDirs: string[] = [];
  const exclude = options.excludePaths ?? new Set<string>();
  const newestLimit =
    options.newestLimit != null && options.newestLimit > 0
      ? options.newestLimit
      : null;

  // Newest folders first when doing limited newest discovery.
  const queue: DirTask[] = [
    { path: start, lastmodMs: Number.POSITIVE_INFINITY },
  ];
  let dirsVisited = 0;
  let active = 0;
  let aborted = false;
  let earlyStop = false;
  let lastProgressAt = 0;
  /** Folders currently being listed (mtime) for safe early-stop checks. */
  const inFlight = new Map<string, number>();

  const checkAbort = async () => {
    if (options.shouldAbort && (await options.shouldAbort())) {
      aborted = true;
      throw new ScanAbortedError();
    }
  };

  const pendingSorted = (): RemoteFile[] =>
    results
      .filter((f) => !exclude.has(f.path))
      .sort((a, b) => fileLastmodMs(b) - fileLastmodMs(a));

  const maxRemainingDirMtime = (): number | null => {
    let max = 0;
    for (const d of queue) {
      max = Math.max(max, d.lastmodMs || 0);
    }
    for (const ms of inFlight.values()) {
      max = Math.max(max, ms || 0);
    }
    return max;
  };

  /** Drop folders that cannot beat the Nth newest pending PDF (by folder mtime). */
  const pruneAndMaybeStop = (): boolean => {
    if (newestLimit == null) return false;
    const pending = pendingSorted();
    if (pending.length < newestLimit) return false;

    const cutoff = fileLastmodMs(pending[newestLimit - 1]!);
    if (cutoff <= 0) return false;

    for (let i = queue.length - 1; i >= 0; i--) {
      const ms = queue[i]!.lastmodMs || 0;
      // Keep unknown mtime (0) and ties (== cutoff); only drop strictly older.
      if (ms > 0 && ms < cutoff) {
        queue.splice(i, 1);
      }
    }

    const rem = maxRemainingDirMtime() ?? 0;
    return rem < cutoff && queue.length === 0;
  };

  const emitProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 800) return;
    lastProgressAt = now;
    const pending = results.filter((f) => !exclude.has(f.path)).length;
    await options.onProgress?.({
      found: results.length,
      pending,
      dirsVisited,
      skippedDirs: skippedDirs.length,
      earlyStop,
    });
  };

  const pushDir = (path: string, lastmodMs: number) => {
    if (earlyStop || aborted) return;
    if (newestLimit != null) {
      const task = { path, lastmodMs };
      let i = 0;
      while (i < queue.length && queue[i]!.lastmodMs >= lastmodMs) i++;
      queue.splice(i, 0, task);
    } else {
      queue.push({ path, lastmodMs });
    }
  };

  const processDir = async (dir: string, dirMtime: number): Promise<void> => {
    if (earlyStop || aborted) return;
    await checkAbort();
    inFlight.set(dir, dirMtime);

    let items: FileStat | FileStat[];
    try {
      items = await options.client.getDirectoryContents(dir);
    } catch (err) {
      console.warn(
        `[webdav] skip dir ${dir}:`,
        err instanceof Error ? err.message : err
      );
      skippedDirs.push(dir);
      inFlight.delete(dir);
      return;
    }

    // Always consume this listing (in-flight work was already paid for).
    // Only skip enqueueing more children once earlyStop is set.
    const list = Array.isArray(items) ? items : [items];
    dirsVisited++;

    for (const item of list) {
      if (aborted) break;
      if (item.type === "directory") {
        if (item.filename === dir || item.filename === `${dir}/`) continue;
        if (!earlyStop) pushDir(item.filename, dirLastmodMs(item));
        continue;
      }
      if (!isPdfFile(item)) continue;
      results.push(toRemoteFile(item));
    }

    inFlight.delete(dir);

    if (newestLimit != null && pruneAndMaybeStop()) {
      earlyStop = true;
      queue.length = 0;
    }

    await emitProgress();
  };

  await checkAbort();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const pump = () => {
      if (settled) return;
      if (aborted) return;

      if (earlyStop) {
        if (active === 0) finish();
        return;
      }

      while (active < concurrency && queue.length > 0 && !earlyStop && !aborted) {
        const task = queue.shift()!;
        active++;
        processDir(task.path, task.lastmodMs)
          .catch((err) => {
            aborted = true;
            queue.length = 0;
            inFlight.clear();
            finish(err);
          })
          .finally(() => {
            active--;
            if (settled) return;
            if (aborted) return;
            if (earlyStop) {
              queue.length = 0;
              if (active === 0) finish();
              return;
            }
            if (queue.length === 0 && active === 0) {
              finish();
              return;
            }
            pump();
          });
      }

      if (!settled && active === 0 && queue.length === 0) finish();
    };

    pump();
  });

  if (aborted) {
    throw new ScanAbortedError();
  }

  await emitProgress(true);

  const files =
    newestLimit != null
      ? pendingSorted()
      : [...results].sort((a, b) => fileLastmodMs(b) - fileLastmodMs(a));

  return {
    files,
    skippedDirs,
    earlyStop,
    dirsVisited,
  };
}

export function createWebDavClient(
  baseUrl: string,
  username: string,
  password: string
) {
  const webdavUrl = `${baseUrl.replace(/\/$/, "")}/remote.php/dav/files/${encodeURIComponent(username)}/`;

  const client = createClient(webdavUrl, {
    username,
    password,
  });

  async function listAllPdfFiles(options?: {
    rootPath?: string;
    shouldAbort?: () => Promise<boolean>;
    onProgress?: (
      found: number,
      meta?: { skippedDirs: number; dirsVisited?: number; earlyStop?: boolean }
    ) => void | Promise<void>;
  }): Promise<{ files: RemoteFile[]; skippedDirs: string[] }> {
    const walked = await walkPdfTree({
      client,
      rootPath: options?.rootPath ?? "/",
      shouldAbort: options?.shouldAbort,
      onProgress: async (p) => {
        await options?.onProgress?.(p.found, {
          skippedDirs: p.skippedDirs,
          dirsVisited: p.dirsVisited,
          earlyStop: p.earlyStop,
        });
      },
    });
    console.log(
      `[webdav] full discovery: ${walked.files.length} PDFs, ${walked.dirsVisited} dirs, concurrency=${discoveryConcurrency()}`
    );
    return { files: walked.files, skippedDirs: walked.skippedDirs };
  }

  /**
   * Find up to `limit` newest PDFs not in excludePaths without necessarily
   * walking the entire tree (parallel + folder-mtime early stop).
   */
  async function listNewestPdfFiles(options: {
    rootPath?: string;
    limit: number;
    excludePaths?: Set<string>;
    shouldAbort?: () => Promise<boolean>;
    onProgress?: (
      found: number,
      meta?: {
        skippedDirs: number;
        pending: number;
        dirsVisited?: number;
        earlyStop?: boolean;
      }
    ) => void | Promise<void>;
  }): Promise<{
    files: RemoteFile[];
    skippedDirs: string[];
    earlyStop: boolean;
    dirsVisited: number;
  }> {
    const limit = Math.max(1, options.limit);
    const walked = await walkPdfTree({
      client,
      rootPath: options.rootPath ?? "/",
      shouldAbort: options.shouldAbort,
      newestLimit: limit,
      excludePaths: options.excludePaths,
      onProgress: async (p) => {
        await options.onProgress?.(p.found, {
          skippedDirs: p.skippedDirs,
          pending: p.pending,
          dirsVisited: p.dirsVisited,
          earlyStop: p.earlyStop,
        });
      },
    });

    const pending = walked.files
      .filter((f) => !options.excludePaths?.has(f.path))
      .sort((a, b) => fileLastmodMs(b) - fileLastmodMs(a))
      .slice(0, limit);

    console.log(
      `[webdav] newest discovery: need=${limit} got=${pending.length} scanned=${walked.files.length} dirs=${walked.dirsVisited} earlyStop=${walked.earlyStop} concurrency=${discoveryConcurrency()}`
    );

    return {
      files: pending,
      skippedDirs: walked.skippedDirs,
      earlyStop: walked.earlyStop,
      dirsVisited: walked.dirsVisited,
    };
  }

  /**
   * Stream download to a temp file while hashing (avoids holding two full copies).
   * AbortSignal destroys the stream mid-transfer on cancel.
   */
  async function downloadToTemp(
    remotePath: string,
    opts?: { signal?: AbortSignal }
  ): Promise<{ tempPath: string; hash: string; size: number }> {
    await mkdir(SYNC_TEMP, { recursive: true });
    const tempPath = join(
      SYNC_TEMP,
      `dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.bin`
    );
    const hash = createHash("sha256");
    let size = 0;

    const signal = opts?.signal;
    if (signal?.aborted) throw new ScanAbortedError();

    const raw = client.createReadStream(remotePath);
    const nodeStream =
      raw instanceof Readable
        ? raw
        : Readable.fromWeb(raw as unknown as import("stream/web").ReadableStream);

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        nodeStream.destroy(new ScanAbortedError());
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      const out = createWriteStream(tempPath);
      nodeStream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        size += buf.length;
      });
      nodeStream.on("error", (err) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        out.destroy();
        reject(
          err?.name === "ScanAbortedError" || signal?.aborted
            ? new ScanAbortedError()
            : err
        );
      });
      out.on("error", (err) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        nodeStream.destroy();
        reject(err);
      });
      out.on("finish", () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      });
      nodeStream.pipe(out);
    });

    return { tempPath, hash: hash.digest("hex"), size };
  }

  /** Fallback buffer download (small files / legacy callers). */
  async function downloadFile(
    remotePath: string,
    opts?: { signal?: AbortSignal }
  ): Promise<Buffer> {
    const { tempPath, size } = await downloadToTemp(remotePath, opts);
    try {
      const { readFile } = await import("fs/promises");
      const buf = await readFile(tempPath);
      if (buf.length !== size) {
        // still return what we have
      }
      return buf;
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  }

  async function testConnection(): Promise<boolean> {
    try {
      await client.getDirectoryContents("/");
      return true;
    } catch {
      return false;
    }
  }

  return {
    listAllPdfFiles,
    listNewestPdfFiles,
    downloadFile,
    downloadToTemp,
    testConnection,
    webdavUrl,
  };
}

/** Move hashed temp file into Paperless consume directory. */
export async function moveTempToConsume(
  tempPath: string,
  originalName: string
): Promise<string> {
  await mkdir(CONSUME_DIR, { recursive: true });
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}_${safeName}`;
  const dest = join(CONSUME_DIR, fileName);
  try {
    await rename(tempPath, dest);
  } catch {
    const { copyFile } = await import("fs/promises");
    await copyFile(tempPath, dest);
    await unlink(tempPath).catch(() => {});
  }
  return fileName;
}

export async function discardTemp(tempPath: string | null | undefined) {
  if (!tempPath) return;
  await unlink(tempPath).catch(() => {});
}
