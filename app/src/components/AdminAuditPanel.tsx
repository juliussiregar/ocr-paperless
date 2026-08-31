"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";

type AuditRange = "today" | "7d" | "30d" | "90d";

type AuditLogRow = {
  id: string;
  action: string;
  title: string;
  category: string;
  description: string | null;
  isError: boolean;
  summary: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

type AuditStats = {
  events: number;
  activeUsers: number;
  errors: number;
  openai: {
    lifetime?: AiUsageBlock;
    period?: AiUsageBlock;
    hits: number;
    events: number;
    sampledEvents?: number;
    partial?: boolean;
    embeddingHits: number;
    promptTokens: number;
    completionTokens: number;
    embeddingTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  byAction: Array<{
    action: string;
    count: number;
    title: string;
    category: string;
  }>;
};

type AiUsageBlock = {
  hits: number;
  events: number;
  embeddingHits: number;
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

const AUDIT_RANGE_KEY = "admin-audit-range";

function readStoredRange(): AuditRange {
  if (typeof window === "undefined") return "30d";
  const saved = localStorage.getItem(AUDIT_RANGE_KEY);
  if (saved === "today" || saved === "7d" || saved === "30d" || saved === "90d") {
    return saved;
  }
  return "30d";
}

const RANGE_OPTIONS: { id: AuditRange; label: string }[] = [
  { id: "today", label: "Hari ini" },
  { id: "7d", label: "7 hari" },
  { id: "30d", label: "1 bulan" },
  { id: "90d", label: "3 bulan" },
];

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("id-ID");
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const d = new Date(t);
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryTone(category: string, isError: boolean): string {
  if (isError) return "bg-red-50 text-red-700 ring-red-200";
  switch (category) {
    case "ai":
      return "bg-teal-50 text-teal-800 ring-teal-200";
    case "scan":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "cloud":
      return "bg-sky-50 text-sky-800 ring-sky-200";
    case "document":
      return "bg-violet-50 text-violet-800 ring-violet-200";
    case "user":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    case "admin":
      return "bg-indigo-50 text-indigo-800 ring-indigo-200";
    default:
      return "bg-slate-50 text-slate-600 ring-slate-200";
  }
}

export function AdminAuditPanel() {
  const [range, setRange] = useState<AuditRange>("30d");
  const [rangeReady, setRangeReady] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    setRange(readStoredRange());
    setRangeReady(true);
  }, []);

  const load = useCallback(
    async (opts: { page: number; append: boolean }) => {
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({
          range,
          page: String(opts.page),
          limit: "25",
        });
        if (errorsOnly) params.set("errors", "1");
        if (actionFilter) params.set("action", actionFilter);
        const res = await fetch(`/api/admin/audit?${params}`);
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error ?? "Gagal memuat audit", "error");
          return;
        }
        setStats(data.stats);
        setTotal(data.total ?? 0);
        setHasMore(Boolean(data.hasMore));
        setPage(data.page ?? opts.page);
        setSince(data.since ?? null);
        const next = (data.logs ?? []) as AuditLogRow[];
        if (opts.append) {
          setLogs((prev) => {
            const ids = new Set(prev.map((l) => l.id));
            return [...prev, ...next.filter((l) => !ids.has(l.id))];
          });
        } else {
          setLogs(next);
          setExpanded(null);
        }
      } catch {
        showToast("Gagal memuat audit", "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [range, errorsOnly, actionFilter]
  );

  useEffect(() => {
    if (!rangeReady) return;
    void load({ page: 1, append: false });
  }, [load, rangeReady]);

  const openai = stats?.openai;
  const lifetime = openai?.lifetime;
  const period = openai?.period ?? openai;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-teal-50/40 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-700/70">
              Observability
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              Audit logs
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Ringkasan aktivitas user, hit OpenAI, perkiraan biaya, dan error
              dalam periode yang dipilih.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load({ page: 1, append: false })}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-teal-300 hover:text-teal-800 disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={cn(loading && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        {/* Quick range filters */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Periode
          </span>
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setRange(opt.id);
                setPage(1);
                localStorage.setItem(AUDIT_RANGE_KEY, opt.id);
              }}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
                range === opt.id
                  ? "bg-teal-700 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-teal-300"
              )}
            >
              {opt.label}
            </button>
          ))}
          {since && (
            <span className="ml-auto text-[11px] text-slate-400">
              Sejak {formatWhen(since)}
            </span>
          )}
        </div>

        {/* KPI cards */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-slate-900 px-4 py-4 text-white shadow-md">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                Total biaya OpenAI
              </p>
              <DollarSign size={16} className="text-teal-300" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
              {loading && !stats
                ? "..."
                : formatUsd(lifetime?.estimatedCostUsd ?? 0)}
            </p>
            <p className="mt-1 text-[11px] text-white/45">
              Akumulasi sejak awal (tidak reset per hari)
            </p>
            {period && (
              <p className="mt-2 text-[11px] text-teal-200/80">
                Periode dipilih: {formatUsd(period.estimatedCostUsd)}
              </p>
            )}
          </div>

          <div className="rounded-xl bg-white px-4 py-4 ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Hit OpenAI (total)
              </p>
              <Sparkles size={16} className="text-teal-600" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {(lifetime?.hits ?? 0).toLocaleString("id-ID")}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {formatTokens(lifetime?.totalTokens ?? 0)} token total
              {(lifetime?.embeddingHits ?? 0) > 0
                ? ` · ${lifetime!.embeddingHits} embed`
                : ""}
            </p>
            {period && (
              <p className="mt-1 text-[11px] text-slate-400">
                Periode: {period.hits} hit · {formatTokens(period.totalTokens)} token
              </p>
            )}
          </div>

          <div className="rounded-xl bg-white px-4 py-4 ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Aktivitas
              </p>
              <Activity size={16} className="text-slate-500" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {(stats?.events ?? 0).toLocaleString("id-ID")}
            </p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Users size={11} />
              {(stats?.activeUsers ?? 0).toLocaleString("id-ID")} user aktif
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setErrorsOnly((v) => !v);
              setActionFilter("");
              setPage(1);
            }}
            className={cn(
              "rounded-xl px-4 py-4 text-left ring-1 transition",
              errorsOnly
                ? "bg-red-50 ring-red-200"
                : "bg-white ring-slate-200/80 hover:ring-red-200"
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Error
              </p>
              <AlertTriangle
                size={16}
                className={errorsOnly ? "text-red-600" : "text-amber-600"}
              />
            </div>
            <p
              className={cn(
                "mt-2 text-2xl font-semibold",
                (stats?.errors ?? 0) > 0 ? "text-red-700" : "text-slate-900"
              )}
            >
              {(stats?.errors ?? 0).toLocaleString("id-ID")}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {errorsOnly ? "Filter error aktif (klik lagi untuk semua)" : "Klik untuk filter error saja"}
            </p>
          </button>
        </div>

        {/* Breakdown chips */}
        {(stats?.byAction?.length ?? 0) > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActionFilter("");
                setErrorsOnly(false);
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium",
                !actionFilter && !errorsOnly
                  ? "bg-slate-800 text-white"
                  : "bg-white text-slate-500 ring-1 ring-slate-200"
              )}
            >
              Semua
            </button>
            {stats!.byAction.slice(0, 10).map((a) => (
              <button
                key={a.action}
                type="button"
                onClick={() => {
                  setActionFilter(a.action);
                  setErrorsOnly(false);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium",
                  actionFilter === a.action
                    ? "bg-teal-700 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-teal-300"
                )}
                title={a.action}
              >
                {a.title}{" "}
                <span className="opacity-60">{a.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-2 sm:px-4">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin text-teal-600" />
            Memuat audit…
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              Belum ada aktivitas di periode ini
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Coba rentang waktu lebih panjang, atau gunakan Ask AI / Search
              untuk menghasilkan log baru.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.map((log) => {
              const open = expanded === log.id;
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((id) => (id === log.id ? null : log.id))
                    }
                    className="flex w-full items-start gap-3 px-3 py-3.5 text-left transition hover:bg-slate-50/80 sm:px-4"
                  >
                    <span className="mt-0.5 text-slate-300">
                      {open ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                            categoryTone(log.category, log.isError)
                          )}
                        >
                          {log.title}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {formatWhen(log.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-800">
                        {log.user ? (
                          <>
                            <span className="font-medium">{log.user.name}</span>
                            <span className="text-slate-400">
                              {" "}
                              · {log.user.email}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">Sistem</span>
                        )}
                      </p>
                      {log.summary && (
                        <p
                          className={cn(
                            "mt-0.5 line-clamp-2 text-[13px]",
                            log.isError
                              ? "text-red-700/90"
                              : "text-slate-500"
                          )}
                        >
                          {log.summary}
                        </p>
                      )}
                    </div>
                  </button>
                  {open && (
                    <div className="mb-3 ml-8 mr-3 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600 ring-1 ring-slate-100 sm:ml-10">
                      {log.description && (
                        <p className="mb-2 text-slate-500">{log.description}</p>
                      )}
                      <dl className="grid gap-1.5 sm:grid-cols-2">
                        <div>
                          <dt className="font-medium text-slate-400">Kode</dt>
                          <dd className="font-mono text-[11px]">{log.action}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-400">Waktu</dt>
                          <dd>{formatWhen(log.createdAt)}</dd>
                        </div>
                        {log.meta &&
                          typeof log.meta.estimatedCostUsd === "number" && (
                            <div>
                              <dt className="font-medium text-slate-400">
                                Biaya event
                              </dt>
                              <dd>
                                {formatUsd(log.meta.estimatedCostUsd as number)}
                                {typeof log.meta.totalTokens === "number" && (
                                  <span className="text-slate-400">
                                    {" "}
                                    · {formatTokens(log.meta.totalTokens as number)}{" "}
                                    token
                                  </span>
                                )}
                              </dd>
                            </div>
                          )}
                      </dl>
                      {log.meta && (
                        <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-white p-2 font-mono text-[10px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
                          {JSON.stringify(log.meta, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(hasMore || logs.length > 0) && (
        <div className="flex flex-col items-center gap-2 border-t border-slate-100 px-4 py-5">
          <p className="text-[11px] text-slate-400">
            Menampilkan {logs.length.toLocaleString("id-ID")} dari{" "}
            {total.toLocaleString("id-ID")} entri
          </p>
          {hasMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load({ page: page + 1, append: true })}
              className="inline-flex min-h-[40px] min-w-[180px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 text-[12px] font-bold uppercase tracking-wider text-white transition hover:bg-slate-800 disabled:opacity-40"
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
          )}
        </div>
      )}
    </section>
  );
}
