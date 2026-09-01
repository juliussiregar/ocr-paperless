import type { PaperlessSearchResult } from "./paperless";
import type { SearchDocumentsOptions } from "./paperless";

type CacheEntry = {
  expires: number;
  result: PaperlessSearchResult;
};

const store = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
  const n = Number(process.env.ASK_SEARCH_CACHE_TTL_MS ?? "60000");
  return Number.isFinite(n) ? Math.min(300_000, Math.max(5_000, Math.floor(n))) : 60_000;
}

function cacheEnabled(): boolean {
  const raw = process.env.ASK_SEARCH_CACHE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function key(
  userId: string | undefined,
  conversationId: string | undefined,
  query: string,
  opts: SearchDocumentsOptions
): string {
  const parts = [
    userId ?? "global",
    conversationId ?? "",
    query.trim().toLowerCase(),
    String(opts.page ?? 1),
    String(opts.pageSize ?? 30),
    opts.ordering ?? "",
    opts.titleOnly ? "title" : "full",
  ];
  return parts.join("|");
}

export async function cachedSearchDocuments(
  searchFn: (
    query: string,
    opts: SearchDocumentsOptions
  ) => Promise<PaperlessSearchResult>,
  query: string,
  opts: SearchDocumentsOptions,
  userId?: string,
  conversationId?: string
): Promise<PaperlessSearchResult> {
  if (!cacheEnabled()) {
    return searchFn(query, opts);
  }
  const k = key(userId, conversationId, query, opts);
  const hit = store.get(k);
  if (hit && hit.expires > Date.now()) {
    return hit.result;
  }
  const result = await searchFn(query, opts);
  store.set(k, { result, expires: Date.now() + cacheTtlMs() });
  if (store.size > 500) {
    const now = Date.now();
    for (const [id, e] of store) {
      if (e.expires < now) store.delete(id);
    }
  }
  return result;
}

export function clearSearchCacheForConversation(conversationId: string): void {
  for (const k of store.keys()) {
    if (k.includes(`|${conversationId}|`)) store.delete(k);
  }
}
