import { createClient, type FileStat } from "webdav";
import {
  bumpTypeCount,
  emptyTypeCounts,
  fileCategoryFromName,
  isIngestibleFileName,
  isPdfFileName,
  type FileCategory,
} from "@/lib/file-types";

export type CloudEntryType = "directory" | "file";

export interface CloudEntry {
  type: CloudEntryType;
  path: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  mimeType: string | null;
  /** Supported document for ingest/OCR (PDF, Office, image, text). */
  isIngestible: boolean;
  /** Legacy flag: PDF category. */
  isPdf: boolean;
  fileCategory: string;
}

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function normalizeEtag(etag: unknown): string | null {
  if (typeof etag === "string" && etag) {
    return etag.replace(/^W\//, "").replace(/"/g, "");
  }
  return null;
}

export type DirectoryListing = {
  entries: CloudEntry[];
  dirEtag: string | null;
  dirLastModified: string | null;
};

export function createUserWebDav(
  baseUrl: string,
  username: string,
  password: string
) {
  const webdavUrl = `${baseUrl.replace(/\/$/, "")}/remote.php/dav/files/${encodeURIComponent(username)}/`;
  const client = createClient(webdavUrl, { username, password });

  async function listDirectory(path: string): Promise<DirectoryListing> {
    const dir = normalizePath(path);
    const items = await client.getDirectoryContents(dir === "/" ? "/" : dir);
    const list = Array.isArray(items) ? items : [items];

    let dirEtag: string | null = null;
    let dirLastModified: string | null = null;
    const dirSelf = list.find(
      (item) =>
        item.type === "directory" &&
        (item.filename === dir || item.filename === `${dir}/`)
    );
    if (dirSelf) {
      dirEtag = normalizeEtag(dirSelf.etag);
      dirLastModified = dirSelf.lastmod
        ? new Date(dirSelf.lastmod).toISOString()
        : null;
    }

    const entries: CloudEntry[] = [];
    for (const item of list) {
      if (item.filename === dir || item.filename === `${dir}/`) continue;

      const mime = item.mime ?? null;
      const ingestible =
        item.type === "file" && isIngestibleFileName(item.basename, mime);

      entries.push({
        type: item.type === "directory" ? "directory" : "file",
        path: item.filename,
        name: item.basename,
        size: typeof item.size === "number" ? item.size : null,
        lastModified: item.lastmod ? new Date(item.lastmod).toISOString() : null,
        mimeType: mime,
        isIngestible: ingestible,
        isPdf: item.type === "file" && isPdfFileName(item.basename, mime),
        fileCategory:
          item.type === "file"
            ? fileCategoryFromName(item.basename, mime)
            : "other",
      });
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, "id");
    });

    return { entries, dirEtag, dirLastModified };
  }

  async function downloadFile(remotePath: string): Promise<Buffer> {
    const content = await client.getFileContents(remotePath);
    if (Buffer.isBuffer(content)) return content;
    if (content instanceof ArrayBuffer) return Buffer.from(content);
    if (typeof content === "string") return Buffer.from(content);
    throw new Error(`Unexpected download type for ${remotePath}`);
  }

  async function searchByName(
    query: string,
    opts?: { maxResults?: number; maxDirs?: number; root?: string }
  ): Promise<CloudEntry[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    const maxResults = opts?.maxResults ?? 40;
    const maxDirs = opts?.maxDirs ?? 120;
    const root = normalizePath(opts?.root ?? "/");

    const hits: CloudEntry[] = [];
    const queue = [root];
    const seen = new Set<string>();
    let dirsVisited = 0;

    while (queue.length > 0 && hits.length < maxResults && dirsVisited < maxDirs) {
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);
      dirsVisited += 1;

      let entries: CloudEntry[];
      try {
        entries = (await listDirectory(dir)).entries;
      } catch {
        continue;
      }

      for (const e of entries) {
        if (e.type === "directory") {
          queue.push(normalizePath(e.path));
          continue;
        }
        if (!e.isIngestible) continue;
        const hay = `${e.name} ${e.path}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push(e);
          if (hits.length >= maxResults) break;
        }
      }
    }

    return hits;
  }

  async function countDocuments(
    rootPath: string,
    opts?: { maxDirs?: number }
  ): Promise<{ total: number; truncated: boolean }> {
    const maxDirs = opts?.maxDirs ?? 500;
    const root = normalizePath(rootPath);
    const queue = [root];
    const seen = new Set<string>();
    let dirsVisited = 0;
    let total = 0;
    let truncated = false;

    while (queue.length > 0) {
      if (dirsVisited >= maxDirs) {
        truncated = true;
        break;
      }
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);
      dirsVisited += 1;

      let entries: CloudEntry[];
      try {
        entries = (await listDirectory(dir)).entries;
      } catch {
        continue;
      }

      for (const e of entries) {
        if (e.type === "directory") {
          queue.push(normalizePath(e.path));
        } else if (e.isIngestible) {
          total += 1;
        }
      }
    }

    return { total, truncated };
  }

  async function scanDocuments(
    rootPath: string,
    opts?: { maxDirs?: number }
  ): Promise<{
    documentCount: number;
    totalSize: number;
    zeroByteCount: number;
    byType: Record<FileCategory, number>;
    truncated: boolean;
    dirsVisited: number;
  }> {
    const maxDirs = opts?.maxDirs ?? 800;
    const root = normalizePath(rootPath);
    const queue = [root];
    const seen = new Set<string>();
    let dirsVisited = 0;
    let documentCount = 0;
    let totalSize = 0;
    let zeroByteCount = 0;
    let truncated = false;
    const byType = emptyTypeCounts();

    while (queue.length > 0) {
      if (dirsVisited >= maxDirs) {
        truncated = true;
        break;
      }
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);
      dirsVisited += 1;

      let entries: CloudEntry[];
      try {
        entries = (await listDirectory(dir)).entries;
      } catch {
        continue;
      }

      for (const e of entries) {
        if (e.type === "directory") {
          queue.push(normalizePath(e.path));
          continue;
        }
        if (!e.isIngestible) continue;
        documentCount += 1;
        const size = e.size ?? 0;
        totalSize += size;
        if (e.size === 0) zeroByteCount += 1;
        bumpTypeCount(byType, e.name, e.mimeType);
      }
    }

    return {
      documentCount,
      totalSize,
      zeroByteCount,
      byType,
      truncated,
      dirsVisited,
    };
  }

  /** @deprecated use countDocuments */
  async function countPdfs(
    rootPath: string,
    opts?: { maxDirs?: number; onlyPending?: boolean }
  ): Promise<{ total: number; truncated: boolean }> {
    return countDocuments(rootPath, { maxDirs: opts?.maxDirs });
  }

  async function countNewInFolder(
    folderPath: string,
    since: Date
  ): Promise<number> {
    const entries = (await listDirectory(folderPath)).entries;
    const sinceMs = since.getTime();
    return entries.filter((e) => {
      if (e.type !== "file" || !e.isIngestible || !e.lastModified) return false;
      return new Date(e.lastModified).getTime() > sinceMs;
    }).length;
  }

  return {
    listDirectory,
    downloadFile,
    searchByName,
    countDocuments,
    scanDocuments,
    countPdfs,
    countNewInFolder,
    webdavUrl,
    normalizePath,
  };
}
