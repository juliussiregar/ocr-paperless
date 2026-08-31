import { getRedis } from "@/lib/queue";
import { invalidateListingCache } from "@/lib/cloud-listing-cache";

const LIVE_SUMMARY_KEY = (userId: string) => `cloud:live-summary:${userId}`;

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/** Folder paths whose listing cache should refresh after ingest. */
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

export function seedPathsFromJobPayload(
  selectedPaths: string | null
): string[] {
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

export async function invalidateLiveSummaryCache(userId: string): Promise<void> {
  await getRedis().del(LIVE_SUMMARY_KEY(userId));
}

export async function invalidateCloudCaches(
  userId: string,
  seedPaths: string[],
  options?: { invalidateLive?: boolean }
): Promise<string[]> {
  const folders = foldersToInvalidate(seedPaths);
  await Promise.all(
    folders.map((folder) => invalidateListingCache(userId, folder))
  );
  if (options?.invalidateLive !== false) {
    await invalidateLiveSummaryCache(userId);
  }
  return folders;
}
