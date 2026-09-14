"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { humanizeFileName } from "@/lib/display-name";
import { DocPreviewLink } from "@/components/DocPreviewLink";
import { CloudSyncSummaryPanel } from "@/components/CloudSyncSummaryPanel";
import {
  DocumentPreviewSheet,
  PREVIEW_DEFAULT,
  PreviewResizeHandle,
  createPreviewResizeHandler,
  readStoredPreviewWidth,
  storePreviewWidth,
} from "@/components/DocumentPreviewSheet";

type SearchHit = {
  id: number;
  title: string;
  fileName: string;
  displayName: string;
  remotePath: string | null;
  content: string;
  pageCount: number;
  created: string;
  modified: string;
};

type SearchSummary = {
  total: number;
  countIsPartial: boolean;
  topFolders: { path: string; count: number }[];
  oldestCreated: string | null;
  newestCreated: string | null;
};

type SortKey = "relevance" | "newest" | "oldest" | "name";

const HISTORY_KEY = "docsearch:search-history";
const HISTORY_MAX = 8;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function pushHistory(q: string) {
  const next = [q, ...loadHistory().filter((x) => x !== q)].slice(
    0,
    HISTORY_MAX
  );
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSnippet(content: string, query: string): ReactNode {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "Tidak ada cuplikan OCR.";

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 6);

  let idx = -1;
  let matched = "";
  for (const t of tokens) {
    const i = text.toLowerCase().indexOf(t);
    if (i !== -1) {
      idx = i;
      matched = t;
      break;
    }
  }
  if (idx === -1) {
    const cut = text.slice(0, 200);
    return cut + (text.length > 200 ? "..." : "");
  }

  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + matched.length + 100);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";

  if (tokens.length === 0) return snippet;

  const re = new RegExp(`(${tokens.map(escapeRegex).join("|")})`, "gi");
  const parts = snippet.split(re);
  return parts.map((part, i) =>
    tokens.some((t) => part.toLowerCase() === t) ? (
      <mark
        key={i}
        className="bg-[var(--auth-teal)]/15 font-medium text-[var(--auth-teal-deep)]"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function folderChipLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]} / ${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || path;
}

function askAiHref(docId: number, folderPath?: string): string {
  const params = new URLSearchParams();
  params.set("doc", String(docId));
  if (folderPath) params.set("folder", folderPath);
  return `/?${params.toString()}`;
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  return new Date(t).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateRange(
  oldest: string | null,
  newest: string | null
): string | null {
  if (!oldest && !newest) return null;
  if (oldest && newest && oldest.slice(0, 10) === newest.slice(0, 10)) {
    return formatShortDate(oldest);
  }
  if (oldest && newest) {
    return `${formatShortDate(oldest)} - ${formatShortDate(newest)}`;
  }
  return formatShortDate(oldest || newest);
}

export function SearchWorkspace({ documentCount }: { documentCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [folder, setFolder] = useState(searchParams.get("folder") ?? "");
  const [titleOnly, setTitleOnly] = useState(
    searchParams.get("titleOnly") === "1"
  );
  const [sort, setSort] = useState<SortKey>(
    (searchParams.get("sort") as SortKey) || "relevance"
  );
  const [dateFrom, setDateFrom] = useState(searchParams.get("from") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("to") ?? "");

  const [results, setResults] = useState<SearchHit[]>([]);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [countIsPartial, setCountIsPartial] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [queryUsed, setQueryUsed] = useState("");
  const [querySanitized, setQuerySanitized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_DEFAULT);
  const [previewResizing, setPreviewResizing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipUrlWrite = useRef(false);
  const loadMoreLock = useRef(false);

  const selected = useMemo(() => {
    const fromResults = results.find((r) => r.id === selectedId);
    if (fromResults) {
      return {
        id: fromResults.id,
        displayName:
          fromResults.displayName ||
          humanizeFileName(fromResults.title || fromResults.fileName),
      };
    }
    return null;
  }, [results, selectedId]);

  useEffect(() => {
    setHistory(loadHistory());
    setPreviewWidth(readStoredPreviewWidth());
    void fetch("/api/search?q=")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.folders)) setFolders(data.folders);
      })
      .catch(() => undefined);
  }, []);

  const startPreviewResize = useCallback(
    createPreviewResizeHandler(
      previewWidth,
      setPreviewWidth,
      setPreviewResizing
    ),
    [previewWidth]
  );

  const resetPreviewWidth = useCallback(() => {
    setPreviewWidth(PREVIEW_DEFAULT);
    storePreviewWidth(PREVIEW_DEFAULT);
  }, []);

  const syncUrl = useCallback(
    (opts: {
      q: string;
      folder: string;
      titleOnly: boolean;
      sort: SortKey;
      from: string;
      to: string;
    }) => {
      const params = new URLSearchParams();
      if (opts.q.trim()) params.set("q", opts.q.trim());
      if (opts.folder) params.set("folder", opts.folder);
      if (opts.titleOnly) params.set("titleOnly", "1");
      if (opts.sort && opts.sort !== "relevance") params.set("sort", opts.sort);
      if (opts.from) params.set("from", opts.from);
      if (opts.to) params.set("to", opts.to);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  const resetToFeed = useCallback(() => {
    setQuery("");
    setResults([]);
    setSummary(null);
    setSearched(false);
    setSelectedId(null);
    setError(null);
    setQueryUsed("");
    setQuerySanitized(false);
    setCount(0);
    setHasMore(false);
    setPage(1);
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const runSearch = useCallback(
    async (
      opts: {
        q: string;
        folder: string;
        titleOnly: boolean;
        sort: SortKey;
        from: string;
        to: string;
        page?: number;
        append?: boolean;
        saveHistory?: boolean;
      },
      writeUrl = true
    ) => {
      const q = opts.q.trim();
      if (!q) {
        setResults([]);
        setSummary(null);
        setCount(0);
        setSearched(false);
        setError(null);
        setSelectedId(null);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const pageNum = opts.page ?? 1;
      if (opts.append) setLoadingMore(true);
      else {
        setLoading(true);
        setSearched(true);
        setError(null);
        setSelectedId(null);
        setMobilePreview(false);
      }

      if (writeUrl && !skipUrlWrite.current) {
        syncUrl({
          q,
          folder: opts.folder,
          titleOnly: opts.titleOnly,
          sort: opts.sort,
          from: opts.from,
          to: opts.to,
        });
      }

      try {
        const params = new URLSearchParams({
          q,
          page: String(pageNum),
          sort: opts.sort,
        });
        if (opts.folder) params.set("folder", opts.folder);
        if (opts.titleOnly) params.set("titleOnly", "1");
        if (opts.from) params.set("from", opts.from);
        if (opts.to) params.set("to", opts.to);

        const res = await fetch(`/api/search?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Pencarian gagal");

        const nextResults: SearchHit[] = data.results ?? [];
        setFolders(data.folders ?? []);
        setCount(data.count ?? 0);
        setCountIsPartial(Boolean(data.countIsPartial));
        setHasMore(Boolean(data.hasMore));
        setPage(data.page ?? pageNum);
        setQueryUsed(data.queryUsed ?? q);
        setQuerySanitized(Boolean(data.querySanitized));
        if (!opts.append) {
          setSummary((data.summary as SearchSummary | null) ?? null);
        }

        if (opts.append) {
          setResults((prev) => {
            const ids = new Set(prev.map((r) => r.id));
            return [...prev, ...nextResults.filter((r) => !ids.has(r.id))];
          });
        } else {
          setResults(nextResults);
          setSelectedId(nextResults[0]?.id ?? null);
          if (opts.saveHistory && q.length >= 2) {
            setHistory(pushHistory(q));
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Pencarian gagal");
        if (!opts.append) {
          setResults([]);
          setSummary(null);
          setCount(0);
          setSelectedId(null);
        }
      } finally {
        // Ignore stale aborts so a newer request keeps its loading state
        if (abortRef.current === controller) {
          setLoading(false);
          setLoadingMore(false);
          loadMoreLock.current = false;
        }
      }
    },
    [syncUrl]
  );

  // Initial search from URL
  useEffect(() => {
    const q = searchParams.get("q");
    if (q?.trim()) {
      skipUrlWrite.current = true;
      runSearch(
        {
          q,
          folder: searchParams.get("folder") ?? "",
          titleOnly: searchParams.get("titleOnly") === "1",
          sort: (searchParams.get("sort") as SortKey) || "relevance",
          from: searchParams.get("from") ?? "",
          to: searchParams.get("to") ?? "",
          saveHistory: false,
        },
        false
      ).finally(() => {
        skipUrlWrite.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / first URL only
  }, []);

  function scheduleSearch(next: {
    q?: string;
    folder?: string;
    titleOnly?: boolean;
    sort?: SortKey;
    from?: string;
    to?: string;
  }) {
    const payload = {
      q: next.q ?? query,
      folder: next.folder ?? folder,
      titleOnly: next.titleOnly ?? titleOnly,
      sort: next.sort ?? sort,
      from: next.from ?? dateFrom,
      to: next.to ?? dateTo,
    };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (payload.q.trim().length === 0) {
      debounceRef.current = setTimeout(() => {
        resetToFeed();
      }, 200);
      return;
    }
    if (payload.q.trim().length < 2) {
      return;
    }
    debounceRef.current = setTimeout(() => {
      runSearch({ ...payload, saveHistory: false });
    }, 400);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      resetToFeed();
      return;
    }
    runSearch({
      q: query,
      folder,
      titleOnly,
      sort,
      from: dateFrom,
      to: dateTo,
      saveHistory: true,
    });
  }

  function openPreview(id: number) {
    setSelectedId(id);
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      setMobilePreview(true);
    }
  }

  const loadMore = useCallback(() => {
    if (loadMoreLock.current || !hasMore || loading || loadingMore) return;
    loadMoreLock.current = true;
    void runSearch({
      q: query,
      folder,
      titleOnly,
      sort,
      from: dateFrom,
      to: dateTo,
      page: page + 1,
      append: true,
    });
  }, [
    hasMore,
    loading,
    loadingMore,
    query,
    folder,
    titleOnly,
    sort,
    dateFrom,
    dateTo,
    page,
    runSearch,
  ]);

  const emptyLibrary = documentCount === 0;
  const showSummary = !searched && !emptyLibrary;
  const dateRangeLabel = summary
    ? formatDateRange(summary.oldestCreated, summary.newestCreated)
    : null;
  const shownSearch = results.length;
  const searchTotalLabel = countIsPartial
    ? `${count.toLocaleString("id-ID")}+`
    : count.toLocaleString("id-ID");

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-[var(--auth-paper)] lg:flex-row">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(ellipse 70% 40% at 40% -5%, rgb(11 110 99 / 0.08), transparent 55%)",
          }}
        />

        <div className="relative z-[1] border-b border-[var(--auth-ink)]/[0.06] px-5 pb-4 pt-5 lg:px-8">
          <p className="auth-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-none tracking-[-0.03em] text-[var(--auth-ink)]">
            Search
          </p>
          <p className="mt-2 max-w-xl text-sm text-[var(--auth-ink)]/50">
            Cari di judul dan isi OCR dokumen Anda. Tanpa kata kunci, lihat
            ringkasan sync dari cloud.
          </p>
          <p className="mt-1 text-[11px] text-[var(--auth-ink)]/35">
            {documentCount.toLocaleString("id-ID")} dokumen siap dicari
          </p>

          {emptyLibrary && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--auth-ink)]/[0.06] py-3">
              <p className="text-sm text-[var(--auth-ink)]/55">
                Belum ada dokumen ter-index. Ambil dokumen lewat Library dulu.
              </p>
              <Link
                href="/cloud"
                className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[var(--auth-teal)]"
              >
                Buka Library
                <ArrowRight size={13} />
              </Link>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-5">
            <div className="flex items-end gap-3 border-b border-[var(--auth-ink)]/20 pb-2 focus-within:border-[var(--auth-teal)]">
              <Search
                size={18}
                className="mb-2.5 shrink-0 text-[var(--auth-ink)]/30"
              />
              <input
                type="search"
                value={query}
                disabled={emptyLibrary}
                onChange={(e) => {
                  const v = e.target.value;
                  setQuery(v);
                  scheduleSearch({ q: v });
                }}
                placeholder="Kata kunci, mis. jadwal rapat atau UND.038"
                className="min-h-[44px] flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-[var(--auth-ink)]/30"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    resetToFeed();
                  }}
                  className="mb-2 p-1 text-[var(--auth-ink)]/30 hover:text-[var(--auth-ink)]"
                  aria-label="Hapus"
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !query.trim() || emptyLibrary}
                className="mb-1 text-[12px] font-bold uppercase tracking-wider text-[var(--auth-teal)] disabled:opacity-30"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Cari"
                )}
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
              Filter
            </span>
            <button
              type="button"
              onClick={() => {
                setFolder("");
                if (searched) scheduleSearch({ folder: "" });
              }}
              className={cn(
                !folder
                  ? "font-semibold text-[var(--auth-teal)]"
                  : "text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
              )}
            >
              Semua folder
            </button>
            {folders.slice(0, 6).map((f) => (
              <button
                key={f}
                type="button"
                title={f}
                onClick={() => {
                  setFolder(f);
                  if (searched) scheduleSearch({ folder: f });
                }}
                className={cn(
                  "max-w-[140px] truncate",
                  folder === f
                    ? "font-semibold text-[var(--auth-teal)]"
                    : "text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
                )}
              >
                {folderChipLabel(f)}
              </button>
            ))}
            {folders.length > 6 && (
              <select
                className="max-w-[160px] border-0 bg-transparent text-[12px] text-[var(--auth-ink)]/50 outline-none"
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                  if (searched) scheduleSearch({ folder: e.target.value });
                }}
              >
                <option value="">Folder lain…</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}

            <span className="text-[var(--auth-ink)]/15">|</span>

            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[var(--auth-ink)]/45">
              <input
                type="checkbox"
                checked={titleOnly}
                onChange={(e) => {
                  setTitleOnly(e.target.checked);
                  if (searched) scheduleSearch({ titleOnly: e.target.checked });
                }}
                className="accent-[var(--auth-teal)]"
              />
              Hanya judul
            </label>

            <select
              value={sort}
              onChange={(e) => {
                const s = e.target.value as SortKey;
                setSort(s);
                if (searched) scheduleSearch({ sort: s });
              }}
              className="border-0 bg-transparent text-[12px] text-[var(--auth-ink)]/50 outline-none"
            >
              <option value="relevance">Paling relevan</option>
              <option value="newest">Terbaru</option>
              <option value="oldest">Terlama</option>
              <option value="name">Nama A-Z</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                if (searched) scheduleSearch({ from: e.target.value });
              }}
              className="border-0 bg-transparent text-[11px] text-[var(--auth-ink)]/45 outline-none"
              title="Dari tanggal"
            />
            <span className="text-[var(--auth-ink)]/25">-</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                if (searched) scheduleSearch({ to: e.target.value });
              }}
              className="border-0 bg-transparent text-[11px] text-[var(--auth-ink)]/45 outline-none"
              title="Sampai tanggal"
            />
          </div>

          <p className="mt-2 text-[11px] text-[var(--auth-ink)]/30">
            Tips: beberapa kata = lebih spesifik. Karakter seperti [ ] dihapus
            otomatis. Centang &quot;Hanya judul&quot; untuk nama file saja.
          </p>

          {!searched && history.length > 0 && !emptyLibrary && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
                Riwayat
              </span>
              {history.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setQuery(h);
                    runSearch({
                      q: h,
                      folder,
                      titleOnly,
                      sort,
                      from: dateFrom,
                      to: dateTo,
                      saveHistory: true,
                    });
                  }}
                  className="text-[12px] text-[var(--auth-ink)]/45 hover:text-[var(--auth-teal)]"
                >
                  {h}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setHistory([]);
                }}
                className="text-[11px] text-[var(--auth-ink)]/30 hover:text-[var(--auth-ink)]"
              >
                Hapus riwayat
              </button>
            </div>
          )}
        </div>

        <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto px-5 py-4 lg:px-8">
          {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

          {querySanitized && searched && queryUsed && (
            <p className="mb-3 text-[12px] text-[var(--auth-ink)]/45">
              Kata kunci disederhanakan menjadi{" "}
              <span className="font-medium text-[var(--auth-ink)]/70">
                &quot;{queryUsed}&quot;
              </span>{" "}
              agar pencarian Paperless berhasil.
            </p>
          )}

          {/* Idle: sync summary */}
          {showSummary && (
            <CloudSyncSummaryPanel variant="search" showIndexedHint />
          )}

          {loading && results.length === 0 && searched && (
            <p className="flex items-center gap-2 py-8 text-sm text-[var(--auth-ink)]/40">
              <Loader2
                size={14}
                className="animate-spin text-[var(--auth-teal)]"
              />
              Mencari…
            </p>
          )}

          {loading && results.length > 0 && (
            <p className="mb-2 flex items-center gap-2 text-[12px] text-[var(--auth-ink)]/35">
              <Loader2
                size={12}
                className="animate-spin text-[var(--auth-teal)]"
              />
              Memperbarui hasil…
            </p>
          )}

          {searched && (!loading || results.length > 0) && (
            <>
              {/* Ringkasan hasil */}
              <div className="mb-5 bg-[var(--auth-teal)]/[0.04] px-4 py-3.5 ring-1 ring-[var(--auth-teal)]/15">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-teal)]/70">
                  Ringkasan
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--auth-ink)]">
                  {searchTotalLabel} dokumen
                  {queryUsed ? (
                    <>
                      {" "}
                      untuk &quot;{queryUsed}&quot;
                    </>
                  ) : null}
                </p>
                <p className="mt-1 text-[12px] text-[var(--auth-ink)]/45">
                  Menampilkan {shownSearch.toLocaleString("id-ID")}
                  {count > shownSearch || countIsPartial
                    ? ` dari ${searchTotalLabel}`
                    : ""}{" "}
                  hasil
                  {folder ? (
                    <span>
                      {" "}
                      · folder {folderChipLabel(folder)}
                    </span>
                  ) : null}
                </p>
                {dateRangeLabel && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--auth-ink)]/45">
                    <Calendar size={12} className="shrink-0" />
                    Tanggal dokumen: {dateRangeLabel}
                  </p>
                )}
                {(summary?.topFolders?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--auth-ink)]/30">
                      Folder terkait
                    </span>
                    {summary!.topFolders.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        title={f.path}
                        onClick={() => {
                          setFolder(f.path);
                          scheduleSearch({ folder: f.path });
                        }}
                        className={cn(
                          "text-[12px]",
                          folder === f.path
                            ? "font-semibold text-[var(--auth-teal)]"
                            : "text-[var(--auth-ink)]/50 hover:text-[var(--auth-teal)]"
                        )}
                      >
                        {folderChipLabel(f.path)}
                        <span className="text-[var(--auth-ink)]/30">
                          {" "}
                          ({f.count})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {results.length === 0 ? (
                <div className="flex flex-col items-start py-10">
                  <SearchX
                    className="mb-3 text-[var(--auth-ink)]/25"
                    size={28}
                  />
                  <p className="auth-display text-lg font-bold text-[var(--auth-ink)]">
                    Tidak ada hasil
                  </p>
                  <p className="mt-2 max-w-md text-sm text-[var(--auth-ink)]/50">
                    Coba kata lain, matikan &quot;Hanya judul&quot;, ganti
                    folder, atau tanya langsung di Tanya Arsip.
                  </p>
                  <Link
                    href="/"
                    className="mt-4 inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--auth-teal)]"
                  >
                    <MessageSquare size={14} />
                    Buka Tanya Arsip
                  </Link>
                </div>
              ) : (
                <ul className="space-y-0">
                  {results.map((doc) => (
                    <li
                      key={doc.id}
                      className="border-t border-[var(--auth-ink)]/[0.07] last:border-b"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openPreview(doc.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPreview(doc.id);
                          }
                        }}
                        className={cn(
                          "group flex w-full cursor-pointer flex-col gap-1.5 py-4 text-left transition hover:pl-1",
                          selectedId === doc.id && "pl-1"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <DocPreviewLink
                            docId={doc.id}
                            className={cn(
                              "text-[15px] font-semibold leading-snug",
                              selectedId === doc.id
                                ? "text-[var(--auth-teal-deep)]"
                                : "text-[var(--auth-ink)] group-hover:text-[var(--auth-teal)]"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {doc.displayName ||
                              humanizeFileName(doc.title || doc.fileName)}
                          </DocPreviewLink>
                          <span className="shrink-0 text-[11px] text-[var(--auth-ink)]/35">
                            {doc.pageCount} hal
                          </span>
                        </div>
                        {doc.remotePath && (
                          <p className="flex items-start gap-1 text-[11px] text-[var(--auth-ink)]/40">
                            <FolderOpen
                              size={11}
                              className="mt-0.5 shrink-0"
                            />
                            <span className="truncate">{doc.remotePath}</span>
                          </p>
                        )}
                        <p className="line-clamp-3 text-[13px] leading-relaxed text-[var(--auth-ink)]/55">
                          {highlightSnippet(doc.content, queryUsed || query)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                          <span className="inline-flex items-center gap-1 text-[var(--auth-ink)]/35">
                            <Calendar size={10} />
                            {formatShortDate(doc.created)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[var(--auth-teal)]">
                            <Eye size={11} />
                            Preview
                          </span>
                          <Link
                            href={askAiHref(doc.id, folder || undefined)}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 font-medium text-[var(--auth-ink)]/45 hover:text-[var(--auth-teal)]"
                          >
                            <MessageSquare size={11} />
                            Tanya Arsip
                          </Link>
                          <a
                            href={`/api/documents/${doc.id}/download`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[var(--auth-ink)]/35 hover:text-[var(--auth-ink)]"
                          >
                            <Download size={11} />
                            Unduh
                          </a>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {searched && hasMore && (
            <div className="flex flex-col items-center gap-2 border-t border-[var(--auth-ink)]/[0.06] py-8">
              <p className="text-[11px] text-[var(--auth-ink)]/35">
                Menampilkan {shownSearch.toLocaleString("id-ID")} dari{" "}
                {searchTotalLabel}
              </p>
              <button
                type="button"
                disabled={loadingMore || loading}
                onClick={() => loadMore()}
                className="inline-flex min-h-[40px] min-w-[200px] items-center justify-center gap-2 bg-[var(--auth-teal)] px-5 text-[12px] font-bold uppercase tracking-wider text-white transition hover:bg-[var(--auth-teal-deep)] disabled:opacity-40"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Memuat…
                  </>
                ) : (
                  "Muat lebih banyak"
                )}
              </button>
            </div>
          )}
          {searched &&
            !hasMore &&
            results.length > 0 &&
            !loading &&
            !loadingMore && (
              <p className="py-6 text-center text-[11px] text-[var(--auth-ink)]/30">
                Semua hasil untuk pencarian ini sudah ditampilkan
              </p>
            )}
        </div>
      </section>

      <aside
        className={cn(
          "relative hidden max-w-[96vw] shrink-0 flex-col border-l border-[var(--auth-ink)]/[0.08] bg-white/70 backdrop-blur-sm lg:flex",
          previewResizing && "select-none"
        )}
        style={{ width: previewWidth }}
      >
        <PreviewResizeHandle
          onResizeStart={startPreviewResize}
          onResetWidth={resetPreviewWidth}
          resizing={previewResizing}
        />
        {selected ? (
          <>
            <div className="space-y-2 border-b border-[var(--auth-ink)]/[0.06] px-4 py-3 pl-5">
              <DocPreviewLink
                docId={selected.id}
                className="auth-display block text-sm font-bold leading-snug"
              >
                {selected.displayName}
              </DocPreviewLink>
              <div className="flex flex-wrap gap-3 text-[11px]">
                <Link
                  href={askAiHref(selected.id, folder || undefined)}
                  className="inline-flex items-center gap-1 font-semibold text-[var(--auth-teal)]"
                >
                  <MessageSquare size={12} />
                  Tanya Arsip
                </Link>
                <a
                  href={`/api/documents/${selected.id}/preview`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--auth-ink)]/45 hover:text-[var(--auth-ink)]"
                >
                  <Eye size={12} />
                  Tab baru
                </a>
                <a
                  href={`/api/documents/${selected.id}/download`}
                  className="inline-flex items-center gap-1 text-[var(--auth-ink)]/45 hover:text-[var(--auth-ink)]"
                >
                  <Download size={12} />
                  Unduh
                </a>
                <span className="hidden text-[10px] tabular-nums text-[var(--auth-ink)]/30 sm:inline">
                  {Math.round(previewWidth)}px
                </span>
              </div>
            </div>
            <iframe
              title="Preview"
              src={`/api/documents/${selected.id}/preview`}
              className="min-h-0 w-full flex-1 bg-[var(--auth-paper)]"
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 pl-5 text-center text-sm text-[var(--auth-ink)]/35">
            <FileText size={28} className="opacity-40" />
            <p>Pilih dokumen untuk melihat preview di sini.</p>
          </div>
        )}
      </aside>

      {mobilePreview && selected && (
        <DocumentPreviewSheet
          docId={selected.id}
          onClose={() => setMobilePreview(false)}
          width={previewWidth}
          onResizeStart={startPreviewResize}
          onResetWidth={resetPreviewWidth}
          resizing={previewResizing}
        />
      )}
    </div>
  );
}
