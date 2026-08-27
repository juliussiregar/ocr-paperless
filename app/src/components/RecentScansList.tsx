"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
} from "lucide-react";
import { humanizeFileName } from "@/lib/display-name";
import { formatSize } from "@/lib/format-size";
import {
  DocumentPreviewSheet,
  PREVIEW_DEFAULT,
  createPreviewResizeHandler,
  readStoredPreviewWidth,
  storePreviewWidth,
} from "@/components/DocumentPreviewSheet";

type RecentFile = {
  id: string;
  fileName: string;
  remotePath: string;
  lastSyncedAt: string | null;
  updatedAt: string;
  paperlessDocumentId: number | null;
  fileSize: number | null;
  displayName: string;
};

function parentFolder(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
}

export function RecentScansList() {
  const [files, setFiles] = useState<RecentFile[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_DEFAULT);
  const [previewResizing, setPreviewResizing] = useState(false);

  const loadPage = useCallback(async (pageNum: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cloud/recent?page=${pageNum}&limit=30`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Gagal memuat daftar scan");
        return;
      }
      setFiles((prev) =>
        append ? [...prev, ...(data.files as RecentFile[])] : data.files
      );
      setHasMore(Boolean(data.hasMore));
      setTotal(Number(data.total) || 0);
      setPage(pageNum);
    } catch {
      setError("Gagal memuat daftar scan");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  useEffect(() => {
    setPreviewWidth(readStoredPreviewWidth());
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => {
      const name = f.displayName || humanizeFileName(f.fileName);
      return (
        name.toLowerCase().includes(q) ||
        f.fileName.toLowerCase().includes(q) ||
        f.remotePath.toLowerCase().includes(q)
      );
    });
  }, [files, query]);

  return (
    <div className="w-full flex-1 px-5 py-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/cloud"
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--auth-teal)] hover:underline"
          >
            <ArrowLeft size={14} />
            Kembali ke Library
          </Link>
          <h1 className="auth-display text-2xl font-bold tracking-[-0.03em] text-[var(--auth-ink)] sm:text-3xl">
            Hasil scan terbaru
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--auth-ink)]/55">
            Semua dokumen yang sudah berhasil di-OCR, diurutkan dari yang
            terbaru.
          </p>
        </div>
        {!loading && (
          <p className="text-sm text-[var(--auth-ink)]/45">
            {total} dokumen
          </p>
        )}
      </div>

      {!loading && files.length > 0 && (
        <div className="relative mb-4 max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--auth-ink)]/30"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama atau path…"
            className="input-field pl-9"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-[var(--auth-ink)]/45">
          <Loader2 size={16} className="animate-spin" />
          Memuat hasil scan…
        </div>
      ) : error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-[var(--auth-ink)]/45">
          Belum ada file yang baru di-scan.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--auth-ink)]/45">
          Tidak ada dokumen yang cocok dengan pencarian.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--auth-ink)]/10 bg-white">
          <div className="hidden border-b border-[var(--auth-ink)]/[0.06] bg-[var(--auth-ink)]/[0.02] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--auth-ink)]/40 sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_9rem_auto] sm:gap-4">
            <span>Dokumen</span>
            <span className="text-right">Size</span>
            <span>Discan</span>
            <span className="text-right">Aksi</span>
          </div>
          <ul>
            {filtered.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--auth-ink)]/[0.06] px-4 py-3 first:border-t-0 hover:bg-[var(--auth-teal)]/[0.03] sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_9rem_auto] sm:gap-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Sparkles
                    size={14}
                    className="mt-0.5 shrink-0 text-[var(--auth-teal)]"
                  />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        f.paperlessDocumentId &&
                        setPreviewId(f.paperlessDocumentId)
                      }
                      disabled={!f.paperlessDocumentId}
                      className="block max-w-full truncate text-left text-sm font-medium text-[var(--auth-ink)] hover:text-[var(--auth-teal)] disabled:cursor-default disabled:hover:text-[var(--auth-ink)]"
                    >
                      {f.displayName || humanizeFileName(f.fileName)}
                    </button>
                    <p className="truncate text-[11px] text-[var(--auth-ink)]/35">
                      {f.remotePath}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--auth-ink)]/50 sm:text-right">
                  {formatSize(f.fileSize)}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--auth-ink)]/40">
                  {(f.lastSyncedAt ?? f.updatedAt)
                    ? new Date(
                        f.lastSyncedAt ?? f.updatedAt
                      ).toLocaleString("id-ID")
                    : "-"}
                </span>
                <div className="flex shrink-0 items-center gap-3 text-[11px] sm:justify-end">
                  {f.paperlessDocumentId && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPreviewId(f.paperlessDocumentId)}
                        className="inline-flex items-center gap-1 font-semibold text-[var(--auth-teal)]"
                      >
                        <Eye size={11} />
                        Preview
                      </button>
                      <Link
                        href={`/?doc=${f.paperlessDocumentId}`}
                        className="inline-flex items-center gap-1 font-semibold text-[var(--auth-teal)]"
                      >
                        <MessageSquare size={11} />
                        Ask AI
                      </Link>
                      <Link
                        href={`/cloud?path=${encodeURIComponent(parentFolder(f.remotePath))}`}
                        className="text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
                      >
                        Folder
                      </Link>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hasMore && !query.trim() && (
            <div className="border-t border-[var(--auth-ink)]/[0.06] px-4 py-3">
              <button
                type="button"
                onClick={() => void loadPage(page + 1, true)}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--auth-teal)] disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Memuat…
                  </>
                ) : (
                  <>
                    Muat lebih banyak
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {previewId != null && (
        <DocumentPreviewSheet
          docId={previewId}
          onClose={() => setPreviewId(null)}
          width={previewWidth}
          onResizeStart={startPreviewResize}
          onResetWidth={resetPreviewWidth}
          resizing={previewResizing}
        />
      )}
    </div>
  );
}
