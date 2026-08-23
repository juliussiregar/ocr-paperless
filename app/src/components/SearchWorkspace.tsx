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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipUrlWrite = useRef(false);

  const selected = useMemo(
    () => results.find((r) => r.id === selectedId) ?? null,
    [results, selectedId]
  );

  useEffect(() => {
    setHistory(loadHistory());
    void fetch("/api/search?q=")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.folders)) setFolders(data.folders);
      })
      .catch(() => undefined);
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
          setCount(0);
          setSelectedId(null);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
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
    // Jangan spam API / riwayat untuk 1 huruf
    if (payload.q.trim().length > 0 && payload.q.trim().length < 2) {
      return;
    }
    debounceRef.current = setTimeout(() => {
      runSearch({ ...payload, saveHistory: false });
    }, 400);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
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
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobilePreview(true);
    }
  }

  const emptyLibrary = documentCount === 0;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-[var(--auth-paper)] lg:flex-row">
      {/* Results column */}
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
            Cari di judul dan isi OCR dokumen Anda. Buka preview, lalu lanjutkan
            di Ask AI bila perlu.
          </p>
          <p className="mt-1 text-[11px] text-[var(--auth-ink)]/35">
            {documentCount.toLocaleString("id-ID")} dokumen siap dicari
          </p>

          {emptyLibrary && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--auth-ink)]/[0.06] py-3">
              <p className="text-sm text-[var(--auth-ink)]/55">
                Belum ada dokumen ter-index. Ambil PDF lewat Library dulu.
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
                    setQuery("");
                    setResults([]);
                    setSearched(false);
                    setSelectedId(null);
                    setError(null);
                    setQueryUsed("");
                    setQuerySanitized(false);
                    router.replace(pathname, { scroll: false });
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
                {loading ? <Loader2 size={16} className="animate-spin" /> : "Cari"}
              </button>
            </div>
          </form>

          {/* Filters */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
              Filter
            </span>
            <button
              type="button"
              onClick={() => {
                setFolder("");
                scheduleSearch({ folder: "" });
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
                  scheduleSearch({ folder: f });
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
                  scheduleSearch({ folder: e.target.value });
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
                  scheduleSearch({ titleOnly: e.target.checked });
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
                scheduleSearch({ sort: s });
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
                scheduleSearch({ from: e.target.value });
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
                scheduleSearch({ to: e.target.value });
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
          {error && (
            <p className="mb-3 text-sm text-red-700">{error}</p>
          )}

          {querySanitized && searched && queryUsed && (
            <p className="mb-3 text-[12px] text-[var(--auth-ink)]/45">
              Kata kunci disederhanakan menjadi{" "}
              <span className="font-medium text-[var(--auth-ink)]/70">
                &quot;{queryUsed}&quot;
              </span>{" "}
              agar pencarian Paperless berhasil.
            </p>
          )}

          {!searched && !loading && !emptyLibrary && (
            <p className="py-12 text-center text-sm text-[var(--auth-ink)]/35">
              Ketik kata kunci. Hasil muncul otomatis, atau tekan Enter.
            </p>
          )}

          {loading && results.length === 0 && (
            <p className="flex items-center gap-2 py-8 text-sm text-[var(--auth-ink)]/40">
              <Loader2 size={14} className="animate-spin text-[var(--auth-teal)]" />
              Mencari…
            </p>
          )}

          {loading && results.length > 0 && (
            <p className="mb-2 flex items-center gap-2 text-[12px] text-[var(--auth-ink)]/35">
              <Loader2 size={12} className="animate-spin text-[var(--auth-teal)]" />
              Memperbarui hasil…
            </p>
          )}

          {searched && (!loading || results.length > 0) && (
            <>
              <p className="mb-3 text-[12px] text-[var(--auth-ink)]/45">
                {count.toLocaleString("id-ID")}
                {countIsPartial ? "+" : ""} dokumen
                {queryUsed ? (
                  <>
                    {" "}
                    untuk &quot;{queryUsed}&quot;
                  </>
                ) : null}
                {folder ? (
                  <span className="text-[var(--auth-ink)]/35">
                    {" "}
                    · folder {folderChipLabel(folder)}
                  </span>
                ) : null}
              </p>

              {results.length === 0 ? (
                <div className="flex flex-col items-start py-10">
                  <SearchX className="mb-3 text-[var(--auth-ink)]/25" size={28} />
                  <p className="auth-display text-lg font-bold text-[var(--auth-ink)]">
                    Tidak ada hasil
                  </p>
                  <p className="mt-2 max-w-md text-sm text-[var(--auth-ink)]/50">
                    Coba kata lain, matikan &quot;Hanya judul&quot;, ganti folder,
                    atau tanya langsung di Ask AI.
                  </p>
                  <Link
                    href="/"
                    className="mt-4 inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--auth-teal)]"
                  >
                    <MessageSquare size={14} />
                    Buka Ask AI
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
                            {new Date(doc.created).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
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
                            Tanya Ask AI
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

              {hasMore && (
                <div className="py-6 text-center">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() =>
                      runSearch({
                        q: query,
                        folder,
                        titleOnly,
                        sort,
                        from: dateFrom,
                        to: dateTo,
                        page: page + 1,
                        append: true,
                      })
                    }
                    className="text-[12px] font-semibold uppercase tracking-wider text-[var(--auth-teal)] disabled:opacity-40"
                  >
                    {loadingMore ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Memuat…
                      </span>
                    ) : (
                      "Muat lebih banyak"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Desktop preview rail */}
      <aside className="hidden w-[min(100%,400px)] shrink-0 flex-col border-l border-[var(--auth-ink)]/[0.08] bg-white/70 backdrop-blur-sm lg:flex">
        {selected ? (
          <>
            <div className="space-y-2 border-b border-[var(--auth-ink)]/[0.06] px-4 py-3">
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
                  Tanya Ask AI
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
              </div>
            </div>
            <iframe
              title="Preview"
              src={`/api/documents/${selected.id}/preview`}
              className="min-h-0 w-full flex-1 bg-[var(--auth-paper)]"
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-[var(--auth-ink)]/35">
            <FileText size={28} className="opacity-40" />
            <p>Pilih hasil untuk melihat preview di sini.</p>
          </div>
        )}
      </aside>

      {/* Mobile preview sheet */}
      {mobilePreview && selected && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--auth-ink)]/30"
            aria-label="Tutup"
            onClick={() => setMobilePreview(false)}
          />
          <div className="absolute inset-x-0 bottom-0 flex h-[82vh] flex-col rounded-t-2xl bg-white shadow-xl">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--auth-ink)]/15" />
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <DocPreviewLink
                  docId={selected.id}
                  className="auth-display block truncate text-sm font-bold"
                >
                  {selected.displayName}
                </DocPreviewLink>
                <Link
                  href={askAiHref(selected.id, folder || undefined)}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--auth-teal)]"
                >
                  <MessageSquare size={12} />
                  Tanya Ask AI
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setMobilePreview(false)}
                className="p-1.5 text-[var(--auth-ink)]/40"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            <iframe
              title="Preview"
              src={`/api/documents/${selected.id}/preview`}
              className="min-h-0 w-full flex-1 bg-[var(--auth-paper)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
