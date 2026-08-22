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
  if (typeof etag !== "string" || !etag) return null;
  return etag.replace(/^W\//, "").replace(/"/g, "");
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
      meta?: { skippedDirs: number }
    ) => void | Promise<void>;
  }): Promise<{ files: RemoteFile[]; skippedDirs: string[] }> {
    const results: RemoteFile[] = [];
    const skippedDirs: string[] = [];
    let dirsVisited = 0;
    const start =
      !options?.rootPath || options.rootPath === "/"
        ? "/"
        : options.rootPath.replace(/\/$/, "") || "/";

    async function walk(dir: string): Promise<void> {
      if (options?.shouldAbort && (await options.shouldAbort())) {
        throw new ScanAbortedError();
      }

      let items;
      try {
        items = await client.getDirectoryContents(dir);
      } catch (err) {
        console.warn(
          `[webdav] skip dir ${dir}:`,
          err instanceof Error ? err.message : err
        );
        skippedDirs.push(dir);
        return;
      }
      const list = Array.isArray(items) ? items : [items];
      dirsVisited++;

      if (dirsVisited % 5 === 0) {
        if (options?.shouldAbort && (await options.shouldAbort())) {
          throw new ScanAbortedError();
        }
        await options?.onProgress?.(results.length, {
          skippedDirs: skippedDirs.length,
        });
      }

      for (const item of list) {
        if (item.type === "directory") {
          if (item.filename === dir || item.filename === `${dir}/`) continue;
          await walk(item.filename);
          continue;
        }

        if (!isPdfFile(item)) continue;

        results.push({
          path: item.filename,
          basename: item.basename,
          etag: normalizeEtag(item.etag),
          lastModified: item.lastmod ? new Date(item.lastmod) : null,
          size: typeof item.size === "number" ? item.size : 0,
          mimeType: item.mime ?? PDF_MIME,
        });
      }
    }

    await walk(start);
    await options?.onProgress?.(results.length, {
      skippedDirs: skippedDirs.length,
    });
    return { files: results, skippedDirs };
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
