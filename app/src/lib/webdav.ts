import { createClient, type FileStat } from "webdav";

export type CloudEntryType = "directory" | "file";

export interface CloudEntry {
  type: CloudEntryType;
  path: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  mimeType: string | null;
  isPdf: boolean;
}

const PDF_MIME = "application/pdf";

function isPdf(item: FileStat): boolean {
  const mime = item.mime ?? "";
  const name = item.basename.toLowerCase();
  return mime === PDF_MIME || name.endsWith(".pdf");
}

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

export function createUserWebDav(
  baseUrl: string,
  username: string,
  password: string
) {
  const webdavUrl = `${baseUrl.replace(/\/$/, "")}/remote.php/dav/files/${encodeURIComponent(username)}/`;
  const client = createClient(webdavUrl, { username, password });

  async function listDirectory(path: string): Promise<CloudEntry[]> {
    const dir = normalizePath(path);
    const items = await client.getDirectoryContents(dir === "/" ? "/" : dir);
    const list = Array.isArray(items) ? items : [items];

    const entries: CloudEntry[] = [];
    for (const item of list) {
      // Skip the directory itself if returned
      if (item.filename === dir || item.filename === `${dir}/`) continue;

      entries.push({
        type: item.type === "directory" ? "directory" : "file",
        path: item.filename,
        name: item.basename,
        size: typeof item.size === "number" ? item.size : null,
        lastModified: item.lastmod ? new Date(item.lastmod).toISOString() : null,
        mimeType: item.mime ?? null,
        isPdf: item.type === "file" && isPdf(item),
      });
    }

    // Folders first, then files; alpha within group
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, "id");
    });

    return entries;
  }

  async function downloadFile(remotePath: string): Promise<Buffer> {
    const content = await client.getFileContents(remotePath);
    if (Buffer.isBuffer(content)) return content;
    if (content instanceof ArrayBuffer) return Buffer.from(content);
    if (typeof content === "string") return Buffer.from(content);
    throw new Error(`Unexpected download type for ${remotePath}`);
  }

  /**
   * BFS filename search across folders. Stops early when maxResults hit
   * or maxDirs folders have been visited (keeps cloud scans bounded).
   */
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
        entries = await listDirectory(dir);
      } catch {
        continue;
      }

      for (const e of entries) {
        if (e.type === "directory") {
          queue.push(normalizePath(e.path));
          continue;
        }
        if (!e.isPdf) continue;
        const hay = `${e.name} ${e.path}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push(e);
          if (hits.length >= maxResults) break;
        }
      }
    }

    return hits;
  }

  /** Count PDFs under a folder (recursive, bounded). */
  async function countPdfs(
    rootPath: string,
    opts?: { maxDirs?: number; onlyPending?: boolean }
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
        entries = await listDirectory(dir);
      } catch {
        continue;
      }

      for (const e of entries) {
        if (e.type === "directory") {
          queue.push(normalizePath(e.path));
        } else if (e.isPdf) {
          total += 1;
        }
      }
    }

    return { total, truncated };
  }

  /** Count PDFs modified after `since` in a single folder (non-recursive). */
  async function countNewInFolder(
    folderPath: string,
    since: Date
  ): Promise<number> {
    const entries = await listDirectory(folderPath);
    const sinceMs = since.getTime();
    return entries.filter((e) => {
      if (e.type !== "file" || !e.isPdf || !e.lastModified) return false;
      return new Date(e.lastModified).getTime() > sinceMs;
    }).length;
  }

  return {
    listDirectory,
    downloadFile,
    searchByName,
    countPdfs,
    countNewInFolder,
    webdavUrl,
    normalizePath,
  };
}
