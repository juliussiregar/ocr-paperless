/** Prefer PAPERLESS_TOKEN; fall back to Docker-style PAPERLESS_API_TOKEN. */
export function getPaperlessToken(): string {
  return (
    process.env.PAPERLESS_TOKEN?.trim() ||
    process.env.PAPERLESS_API_TOKEN?.trim() ||
    ""
  );
}

export function getPaperlessUrl(): string {
  return (process.env.PAPERLESS_URL ?? "http://localhost:8000").replace(
    /\/$/,
    ""
  );
}

export interface PaperlessDocument {
  id: number;
  title: string;
  content: string;
  created: string;
  modified: string;
  original_file_name: string;
  archive_serial_number: number | null;
  page_count: number;
  tags: number[];
  correspondent: number | null;
}

export interface PaperlessSearchResult {
  count: number;
  next: string | null;
  previous: string | null;
  results: PaperlessDocument[];
}

/** Whoosh treats []{}() etc. as syntax; filenames like [PP.08.01] break search with 400. */
export function sanitizePaperlessQuery(raw: string): string {
  return raw
    .replace(/[\[\]{}()"'~^!:\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getPaperlessToken();
  if (token) {
    h.Authorization = `Token ${token}`;
  }
  return h;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transient Paperless / network failures (e.g. Postgres pressure). */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  const retries = Number(process.env.PAPERLESS_FETCH_RETRIES ?? "2");
  const max = Number.isFinite(retries) ? Math.min(4, Math.max(0, retries)) : 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      const res = await fetch(url, init);
      if (
        res.ok ||
        res.status === 400 ||
        res.status === 404 ||
        attempt === max
      ) {
        return res;
      }
      if (res.status >= 500 || res.status === 429) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === max) break;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Paperless ${label} failed after retries`);
}

export type SearchDocumentsOptions = {
  page?: number;
  pageSize?: number;
  ordering?: string;
  /** Title substring only (no full-text Whoosh query) */
  titleOnly?: boolean;
  /** Restrict to these Paperless IDs (comma batches handled by caller) */
  idIn?: number[];
};

export async function searchDocuments(
  query: string,
  pageOrOpts: number | SearchDocumentsOptions = 1
): Promise<PaperlessSearchResult> {
  const opts: SearchDocumentsOptions =
    typeof pageOrOpts === "number" ? { page: pageOrOpts } : pageOrOpts;
  const page = opts.page ?? 1;
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const empty: PaperlessSearchResult = {
    count: 0,
    next: null,
    previous: null,
    results: [],
  };

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (opts.ordering) {
    params.set("ordering", opts.ordering);
  }

  if (opts.idIn && opts.idIn.length > 0) {
    params.set("id__in", opts.idIn.join(","));
  }

  const cleaned = sanitizePaperlessQuery(query);
  if (opts.titleOnly) {
    if (!cleaned) return empty;
    params.set("title__icontains", cleaned);
  } else if (cleaned) {
    params.set("query", cleaned);
  } else if (!opts.idIn?.length) {
    return empty;
  }

  const res = await fetchWithRetry(
    `${getPaperlessUrl()}/api/documents/?${params}`,
    { headers: headers(), next: { revalidate: 0 } },
    "search"
  );

  if (!res.ok) {
    if (res.status === 400) return empty;
    throw new Error(`Paperless search failed: ${res.status}`);
  }

  return res.json();
}

export async function getDocument(id: number): Promise<PaperlessDocument> {
  const res = await fetchWithRetry(
    `${getPaperlessUrl()}/api/documents/${id}/`,
    { headers: headers(), next: { revalidate: 60 } },
    `document ${id}`
  );

  if (!res.ok) throw new Error(`Document ${id} not found`);
  return res.json();
}

export async function getDocumentCount(): Promise<number> {
  const res = await fetch(`${getPaperlessUrl()}/api/documents/?page_size=1`, {
    headers: headers(),
    next: { revalidate: 30 },
  });

  if (!res.ok) return 0;
  const data = (await res.json()) as { count?: number };
  return data.count ?? 0;
}

export function getDocumentDownloadUrl(id: number): string {
  return `${getPaperlessUrl()}/api/documents/${id}/download/`;
}

export function getDocumentThumbnailUrl(id: number): string {
  return `${getPaperlessUrl()}/api/documents/${id}/thumb/`;
}
