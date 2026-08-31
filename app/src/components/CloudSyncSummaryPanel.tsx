"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type TypeRow = { key: string; label: string; count: number };

type TrackedSummary = {
  detected: number;
  downloaded: number;
  failed: number;
  pending: number;
  indexed: number;
  typeBreakdown: TypeRow[];
};

type LiveSummary = {
  documentCount: number;
  totalSize: number;
  zeroByteCount: number;
  typeBreakdown: TypeRow[];
  truncated: boolean;
  dirsVisited: number;
  cachedAt: string;
  expiresAt: string;
};

type SummaryResponse = {
  tracked: TrackedSummary;
  live: LiveSummary | null;
  notTrackedEstimate: number | null;
  notTrackedIsPartial: boolean;
  liveStatus: "cached" | "missing" | "refreshing";
  liveRefreshing: boolean;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatCacheTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--auth-ink)]/[0.08] bg-white/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--auth-ink)]/35">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums text-[var(--auth-ink)]",
          accent && "text-red-600"
        )}
      >
        {value.toLocaleString("id-ID")}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--auth-ink)]/40">{hint}</p>
    </div>
  );
}

function TypeBreakdownList({ rows, title }: { rows: TypeRow[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
        {title}
      </p>
      <ul className="mt-3 divide-y divide-[var(--auth-ink)]/[0.06] rounded-lg border border-[var(--auth-ink)]/[0.08] bg-white/50">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <span className="text-[var(--auth-ink)]/70">{row.label}</span>
            <span className="font-semibold tabular-nums text-[var(--auth-ink)]">
              {row.count.toLocaleString("id-ID")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type CloudSyncSummaryPanelProps = {
  variant?: "search" | "library";
  className?: string;
  showIndexedHint?: boolean;
};

export function CloudSyncSummaryPanel({
  variant = "search",
  className,
  showIndexedHint = false,
}: CloudSyncSummaryPanelProps) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const url = refresh
        ? "/api/cloud/summary?refresh=1"
        : "/api/cloud/summary";
      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string"
            ? json.error
            : "Gagal memuat ringkasan"
        );
      }
      setData(json as SummaryResponse);
      setError(null);
    } catch (err) {
      if (!refresh) setData(null);
      setError(err instanceof Error ? err.message : "Gagal memuat ringkasan");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onInvalidate = () => void load(false);
    window.addEventListener("cloud-cache-invalidated", onInvalidate);
    return () =>
      window.removeEventListener("cloud-cache-invalidated", onInvalidate);
  }, [load]);

  const tracked = data?.tracked;
  const live = data?.live;
  const liveRefreshing = refreshing || data?.liveRefreshing;

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
            Ringkasan
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--auth-ink)]">
            {variant === "library"
              ? "Status sync dan isi cloud"
              : "Status file dari cloud"}
          </p>
        </div>
        <button
          type="button"
          disabled={loading || refreshing}
          onClick={() => void load(true)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--auth-teal)] disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {refreshing ? "Scan cloud…" : "Refresh live"}
        </button>
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load(false)}
            className="text-[12px] font-semibold text-[var(--auth-teal)]"
          >
            Coba lagi
          </button>
        </div>
      )}

      {loading && !tracked && (
        <p className="flex items-center gap-2 py-6 text-sm text-[var(--auth-ink)]/40">
          <Loader2 size={14} className="animate-spin text-[var(--auth-teal)]" />
          Memuat ringkasan…
        </p>
      )}

      {tracked && (
        <div className="space-y-4">
          <p className="text-[11px] font-semibold text-[var(--auth-ink)]/50">
            Tercatat di sistem
            <span className="font-normal text-[var(--auth-ink)]/35">
              {" "}
              (cepat, dari database)
            </span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Terdeteksi"
              value={tracked.detected}
              hint="Sudah masuk sync DB"
            />
            <StatCard
              label="Selesai"
              value={tracked.downloaded}
              hint="Sudah diunduh / OCR"
            />
            <StatCard
              label="Dalam proses"
              value={tracked.pending}
              hint="Antrian atau download"
            />
            <StatCard
              label="Gagal"
              value={tracked.failed}
              hint="Perlu diulang"
              accent={tracked.failed > 0}
            />
          </div>
          <TypeBreakdownList
            rows={tracked.typeBreakdown}
            title="Jenis file (tercatat)"
          />
        </div>
      )}

      <div className="space-y-4 border-t border-[var(--auth-ink)]/[0.06] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-[var(--auth-ink)]/50">
            Live di cloud
            <span className="font-normal text-[var(--auth-ink)]/35">
              {" "}
              (scan WebDAV, cache)
            </span>
          </p>
          {live && !liveRefreshing && (
            <p className="text-[10px] text-[var(--auth-ink)]/35">
              Cache: {formatCacheTime(live.cachedAt)}
            </p>
          )}
        </div>

        {liveRefreshing && !live && (
          <p className="flex items-center gap-2 text-sm text-[var(--auth-ink)]/45">
            <Loader2 size={14} className="animate-spin text-[var(--auth-teal)]" />
            Memindai folder cloud… ini bisa beberapa menit.
          </p>
        )}

        {!live && !liveRefreshing && (
          <p className="text-sm text-[var(--auth-ink)]/45">
            Belum ada data live. Klik{" "}
            <span className="font-medium text-[var(--auth-teal)]">
              Refresh live
            </span>{" "}
            untuk scan cloud (hasil disimpan di cache).
          </p>
        )}

        {live && (
          <div className="space-y-4">
            {liveRefreshing && (
              <p className="flex items-center gap-2 text-[12px] text-[var(--auth-teal)]">
                <Loader2 size={12} className="animate-spin" />
                Memperbarui scan live…
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Dokumen di cloud"
                value={live.documentCount}
                hint="PDF, Office, gambar, teks"
              />
              {data?.notTrackedEstimate != null && (
                <StatCard
                  label="Belum tercatat"
                  value={data.notTrackedEstimate}
                  hint={
                    data.notTrackedIsPartial
                      ? "Perkiraan (scan live terbatas)"
                      : "Di cloud, belum di sync DB"
                  }
                  accent={data.notTrackedEstimate > 0}
                />
              )}
              <div className="rounded-lg border border-[var(--auth-ink)]/[0.08] bg-white/60 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--auth-ink)]/35">
                  Ukuran total
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--auth-ink)]">
                  {formatSize(live.totalSize)}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--auth-ink)]/40">
                  Dokumen didukung
                </p>
              </div>
              <StatCard
                label="Folder dibuka"
                value={live.dirsVisited}
                hint={
                  live.truncated ? "Scan terbatas (truncated)" : "Saat scan"
                }
              />
              <StatCard
                label="File 0 B"
                value={live.zeroByteCount}
                hint="Kosong di cloud"
                accent={live.zeroByteCount > 0}
              />
            </div>
            {live.truncated && (
              <p className="text-[11px] text-amber-800">
                Scan mencapai batas folder. Angka live mungkin lebih besar.
                Refresh lagi setelah cache habis untuk perkiraan lebih lengkap.
              </p>
            )}
            <TypeBreakdownList
              rows={live.typeBreakdown}
              title="Jenis file (live cloud)"
            />
          </div>
        )}
      </div>

      {showIndexedHint && tracked && (
        <p className="text-[12px] text-[var(--auth-ink)]/45">
          {tracked.indexed.toLocaleString("id-ID")} dokumen siap dicari.
        </p>
      )}
    </div>
  );
}
