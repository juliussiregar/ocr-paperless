import { connection } from "./scan-queues.js";

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function listingCacheKey(userId: string, path: string): string {
  const norm = normalizePath(path);
  return `cloud:listing:${userId}:${encodeURIComponent(norm)}`;
}

const liveSummaryKey = (userId: string) => `cloud:live-summary:${userId}`;

export function foldersToInvalidate(seedPaths: string[]): string[] {
  const set = new Set<string>();
  set.add("/");

  for (const raw of seedPaths) {
    if (!raw?.trim()) continue;
    const norm = normalizePath(raw);
    const parts = norm.split("/").filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
      set.add("/" + parts.slice(0, i + 1).join("/"));
    }

    if (parts.length > 1) {
      set.add("/" + parts.slice(0, -1).join("/"));
    }
  }

  return [...set];
}

export function seedPathsFromJobPayload(selectedPaths: string | null): string[] {
  if (!selectedPaths) return ["/"];
  try {
    const p = JSON.parse(selectedPaths) as Record<string, unknown>;
    if (Array.isArray(p.paths)) {
      return p.paths.filter((x): x is string => typeof x === "string");
    }
    if (typeof p.rootPath === "string" && p.rootPath.trim()) {
      return [p.rootPath.trim()];
    }
  } catch {
    // ignore
  }
  return ["/"];
}

export async function invalidateCloudCaches(
  userId: string,
  seedPaths: string[]
): Promise<void> {
  const folders = foldersToInvalidate(seedPaths);
  const redis = connection;
  const ops = folders.map((folder) => redis.del(listingCacheKey(userId, folder)));
  ops.push(redis.del(liveSummaryKey(userId)));
  await Promise.all(ops);
}

export async function invalidateAfterScanJob(
  userId: string,
  selectedPaths: string | null,
  extraPaths: string[] = []
): Promise<void> {
  const seeds = [
    ...seedPathsFromJobPayload(selectedPaths),
    ...extraPaths,
  ];
  await invalidateCloudCaches(userId, seeds);
}
