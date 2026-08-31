"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Server } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";

interface AutoScanSettings {
  autoScanEnabled: boolean;
  autoScanIntervalMinutes: number;
  autoScanLastRunAt: string | null;
}

interface BacklogRow {
  userId: string;
  email: string;
  name: string | null;
  hasBappenasCreds: boolean;
  lastDiscoveryAt: string | null;
  ocrDone: number;
  ocrPending: number;
  failed: number;
  failedRetryable: number;
  failedExhausted: number;
  downloading: number;
  scanLockHeld: boolean;
  activeJob: {
    id: string;
    jobType: string;
    phase: string | null;
    status: string;
    startedAt?: string | null;
    currentFile?: string | null;
  } | null;
}

interface ScanHealth {
  queues: {
    discover: {
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
    };
    ingest: {
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
    };
  };
  redis: {
    usedMemoryHuman: string;
    maxMemoryHuman: string;
  };
  stuckJobs: Array<{
    id: string;
    jobType: string;
    phase: string | null;
    currentFile: string | null;
    startedAt: string;
    userEmail: string | null;
  }>;
  userLocks: string[];
  ingestMaxRetries: number;
  failedExhaustedTotal: number;
  pgJobCounts: Array<{ status: string; count: number }>;
  throughput?: {
    scanMaxFiles: number;
    discoverConcurrency: number;
    ingestConcurrency: number;
    webdavDiscoveryConcurrency: number;
    webdavDownloadConcurrency: number;
    ocrReconcileIntervalMs: number;
    embedBackfillBatch: number;
    postSyncWarmEnabled: boolean;
    postSyncWarmMaxDirs: number;
  };
  pipeline?: {
    ocrPending: number;
    downloading: number;
    queued: number;
    ocrDone: number;
  };
}

interface RecentJobRow {
  id: string;
  jobType: string;
  status: string;
  phase: string | null;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  newFiles: number;
  errorMessage: string | null;
  currentFile: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  user: { id: string; email: string; name: string | null } | null;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

interface AdminPanelProps {
  initialSettings: AutoScanSettings;
}

export function AdminPanel({ initialSettings }: AdminPanelProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [savingScan, setSavingScan] = useState(false);
  const [intervalInput, setIntervalInput] = useState(
    String(initialSettings.autoScanIntervalMinutes)
  );
  const [backlog, setBacklog] = useState<BacklogRow[]>([]);
  const [recentJobs, setRecentJobs] = useState<RecentJobRow[]>([]);
  const [scanHealth, setScanHealth] = useState<ScanHealth | null>(null);
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [triggeringUserId, setTriggeringUserId] = useState<string | null>(null);
  const [releasingLockUserId, setReleasingLockUserId] = useState<string | null>(
    null
  );

  function showMsg(text: string, type: "success" | "error" = "success") {
    showToast(text, type);
  }

  async function saveSettings(
    patch: Record<string, unknown>,
    options?: { silent?: boolean }
  ) {
    setSavingScan(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateSettings", ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal menyimpan pengaturan", "error");
        return null;
      }
      setSettings(data.settings);
      setIntervalInput(String(data.settings.autoScanIntervalMinutes));
      if (!options?.silent) {
        showMsg("Pengaturan sync disimpan");
      }
      return data;
    } finally {
      setSavingScan(false);
    }
  }

  async function toggleAutoSync() {
    const turningOn = !settings.autoScanEnabled;
    setSavingScan(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateSettings",
          autoScanEnabled: turningOn,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal mengubah sync otomatis", "error");
        return;
      }
      setSettings(data.settings);
      setIntervalInput(String(data.settings.autoScanIntervalMinutes));
      void loadBacklog();

      if (turningOn) {
        if (data.syncTriggerError) {
          showMsg(
            `Jadwal aktif, tapi sync sekarang gagal: ${data.syncTriggerError}`,
            "error"
          );
          return;
        }
        const enqueued = data.syncTrigger?.enqueued?.length ?? 0;
        const skipped = data.syncTrigger?.skippedActive?.length ?? 0;
        showMsg(
          `Sync otomatis aktif. ${enqueued} job dibuat sekarang.${skipped > 0 ? ` ${skipped} user dilewati (job aktif).` : ""} Matikan toggle ini untuk hentikan jadwal.`
        );
      } else {
        const cancelled = data.syncCancel?.cancelledJobIds?.length ?? 0;
        const abandoned = data.syncCancel?.abandonedFiles ?? 0;
        showMsg(
          cancelled > 0
            ? `Sync otomatis dimatikan. ${cancelled} job dibatalkan, ${abandoned} file antre dibersihkan.`
            : "Sync otomatis dimatikan."
        );
      }
    } finally {
      setSavingScan(false);
    }
  }

  const loadBacklog = useCallback(async () => {
    setBacklogLoading(true);
    try {
      const res = await fetch("/api/admin/scan");
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal memuat backlog", "error");
        return;
      }
      setBacklog(data.backlog ?? []);
      setRecentJobs(data.recentJobs ?? []);
      setScanHealth(data.health ?? null);
    } finally {
      setBacklogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBacklog();
  }, [loadBacklog]);

  async function triggerDelta(userId: string, reconcileOnly = false) {
    setTriggeringUserId(userId);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          reconcileOnly,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal trigger scan", "error");
        return;
      }
      showMsg(
        reconcileOnly
          ? `Reconcile job ${data.jobId} dibuat`
          : `Delta sync job ${data.jobId} dibuat`
      );
      void loadBacklog();
    } finally {
      setTriggeringUserId(null);
    }
  }

  async function releaseUserLock(userId: string) {
    setReleasingLockUserId(userId);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "releaseLock", userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal release lock", "error");
        return;
      }
      showMsg(data.released ? "Scan lock dilepas" : "Tidak ada lock aktif");
      void loadBacklog();
    } finally {
      setReleasingLockUserId(null);
    }
  }

  const schedulerActive = settings.autoScanEnabled;

  return (
    <div className="space-y-6">
      <AdminAuditPanel />

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <Server size={18} />
              </div>
              <div>
                <h2 className="section-title">Scan health</h2>
                <p className="text-xs text-slate-500">
                  Queue BullMQ, Redis, job macet, dan user lock.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={backlogLoading}
              onClick={() => void loadBacklog()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Discover queue</p>
            <p className="mt-1 tabular-nums text-slate-800">
              wait {scanHealth?.queues.discover.waiting ?? 0} · active{" "}
              {scanHealth?.queues.discover.active ?? 0} · delayed{" "}
              {scanHealth?.queues.discover.delayed ?? 0}
            </p>
            {(scanHealth?.queues.discover.failed ?? 0) > 0 && (
              <p className="mt-0.5 text-red-600">
                failed {scanHealth?.queues.discover.failed}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Ingest queue</p>
            <p className="mt-1 tabular-nums text-slate-800">
              wait {scanHealth?.queues.ingest.waiting ?? 0} · active{" "}
              {scanHealth?.queues.ingest.active ?? 0} · delayed{" "}
              {scanHealth?.queues.ingest.delayed ?? 0}
            </p>
            {(scanHealth?.queues.ingest.failed ?? 0) > 0 && (
              <p className="mt-0.5 text-red-600">
                failed {scanHealth?.queues.ingest.failed}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Pipeline file</p>
            <p className="mt-1 tabular-nums text-slate-800">
              OCR pending {scanHealth?.pipeline?.ocrPending ?? 0} · unduh{" "}
              {scanHealth?.pipeline?.downloading ?? 0} · antri{" "}
              {scanHealth?.pipeline?.queued ?? 0}
            </p>
            <p className="mt-0.5 text-slate-500">
              OCR selesai {scanHealth?.pipeline?.ocrDone ?? 0} (reconcile tiap{" "}
              {Math.round(
                (scanHealth?.throughput?.ocrReconcileIntervalMs ?? 15000) /
                  1000
              )}
              s)
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Redis</p>
            <p className="mt-1 text-slate-800">
              {scanHealth?.redis.usedMemoryHuman ?? "-"} /{" "}
              {scanHealth?.redis.maxMemoryHuman ?? "-"}
            </p>
            <p className="mt-0.5 text-slate-500">
              Failed habis retry: {scanHealth?.failedExhaustedTotal ?? 0} (max{" "}
              {scanHealth?.ingestMaxRetries ?? 5})
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">User locks</p>
            <p className="mt-1 text-slate-800">
              {scanHealth?.userLocks.length ?? 0} aktif
            </p>
            {scanHealth?.pgJobCounts && scanHealth.pgJobCounts.length > 0 && (
              <p className="mt-0.5 text-slate-500">
                Job DB:{" "}
                {scanHealth.pgJobCounts
                  .map((r) => `${r.status}: ${r.count}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
        {scanHealth && scanHealth.stuckJobs.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-xs font-medium text-amber-800">
              Job RUNNING macet ({scanHealth.stuckJobs.length})
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {scanHealth.stuckJobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded border border-amber-100 bg-amber-50 px-2 py-1"
                >
                  <span className="font-mono text-slate-700">{job.id}</span>
                  {job.userEmail && (
                    <span className="text-slate-500"> · {job.userEmail}</span>
                  )}
                  <span className="text-slate-500">
                    {" "}
                    · {job.jobType} / {job.phase ?? "?"}
                  </span>
                  {job.currentFile && (
                    <span className="block truncate text-slate-400">
                      {job.currentFile}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {scanHealth?.throughput && (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">
              Throughput aktif (env worker / app)
            </p>
            <p className="mt-1 tabular-nums">
              batch{" "}
              {scanHealth.throughput.scanMaxFiles === 0
                ? "tanpa batas"
                : scanHealth.throughput.scanMaxFiles}{" "}
              · discover{" "}
              {scanHealth.throughput.discoverConcurrency} · ingest{" "}
              {scanHealth.throughput.ingestConcurrency} · webdav list{" "}
              {scanHealth.throughput.webdavDiscoveryConcurrency} · download{" "}
              {scanHealth.throughput.webdavDownloadConcurrency}
            </p>
            <p className="mt-0.5 tabular-nums">
              OCR poll {scanHealth.throughput.ocrReconcileIntervalMs} ms · embed
              batch {scanHealth.throughput.embedBackfillBatch} · post-sync warm{" "}
              {scanHealth.throughput.postSyncWarmEnabled
                ? `on (max ${scanHealth.throughput.postSyncWarmMaxDirs} folder)`
                : "off"}
            </p>
          </div>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                <Activity size={18} />
              </div>
              <div>
                <h2 className="section-title">Backlog OCR</h2>
                <p className="text-xs text-slate-500">
                  Status sync per user. Trigger delta_sync manual dari sini.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={backlogLoading}
              onClick={() => void loadBacklog()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              {backlogLoading ? "Memuat..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">OCR done</th>
                <th className="py-2 pr-3">Pending</th>
                <th className="py-2 pr-3">Failed</th>
                <th className="py-2 pr-3">Lock</th>
                <th className="py-2 pr-3">Active job</th>
                <th className="py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {backlog.length === 0 && !backlogLoading && (
                <tr>
                  <td colSpan={7} className="py-4 text-slate-400">
                    Tidak ada data user
                  </td>
                </tr>
              )}
              {backlog.map((row) => (
                <tr key={row.userId} className="border-b border-slate-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800">{row.email}</div>
                    {row.name && (
                      <div className="text-slate-400">{row.name}</div>
                    )}
                    {!row.hasBappenasCreds && (
                      <div className="text-[10px] text-amber-700">
                        Tanpa kredensial Bappenas
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">{row.ocrDone}</td>
                  <td className="py-2 pr-3">{row.ocrPending}</td>
                  <td className="py-2 pr-3">
                    {row.failed > 0 ? (
                      <div>
                        <span className="text-red-600">{row.failed}</span>
                        <div className="text-[10px] text-slate-400">
                          retry {row.failedRetryable} · habis{" "}
                          {row.failedExhausted}
                        </div>
                      </div>
                    ) : (
                      row.failed
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {row.scanLockHeld ? (
                      <button
                        type="button"
                        disabled={releasingLockUserId === row.userId}
                        onClick={() => void releaseUserLock(row.userId)}
                        className="rounded border border-amber-200 px-2 py-0.5 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {releasingLockUserId === row.userId
                          ? "..."
                          : "Release"}
                      </button>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {row.activeJob
                      ? `${row.activeJob.jobType} (${row.activeJob.phase ?? row.activeJob.status})`
                      : "-"}
                  </td>
                  <td className="py-2">
                    {row.hasBappenasCreds ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={
                            triggeringUserId === row.userId ||
                            row.activeJob != null
                          }
                          onClick={() => void triggerDelta(row.userId)}
                          className="rounded border border-teal-200 px-2 py-1 text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                        >
                          Delta
                        </button>
                        <button
                          type="button"
                          disabled={
                            triggeringUserId === row.userId ||
                            row.activeJob != null
                          }
                          onClick={() => void triggerDelta(row.userId, true)}
                          className="rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Reconcile
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-400">Tidak tersedia</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Riwayat job sync</h2>
              <p className="mt-1 text-xs text-slate-500">
                50 job terakhir. Detail per file:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                  docker compose logs --tail=200 sync-worker
                </code>
              </p>
            </div>
            <button
              type="button"
              disabled={backlogLoading}
              onClick={() => void loadBacklog()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Tipe</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Fase</th>
                <th className="py-2 pr-3">Progres</th>
                <th className="py-2 pr-3">Durasi</th>
                <th className="py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.length === 0 && !backlogLoading && (
                <tr>
                  <td colSpan={8} className="py-4 text-slate-400">
                    Belum ada job
                  </td>
                </tr>
              )}
              {recentJobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3 text-slate-500">
                    {new Date(job.createdAt).toLocaleString("id-ID")}
                  </td>
                  <td className="py-2 pr-3">
                    {job.user?.email ?? "-"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-700">
                    {job.jobType}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        job.status === "COMPLETED" && "bg-teal-50 text-teal-700",
                        job.status === "RUNNING" && "bg-blue-50 text-blue-700",
                        job.status === "FAILED" && "bg-red-50 text-red-700",
                        job.status === "PENDING" && "bg-slate-100 text-slate-600",
                        job.status === "CANCELLED" && "bg-slate-100 text-slate-500"
                      )}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {job.phase ?? "-"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-slate-600">
                    {job.processedFiles}/{job.totalFiles}
                    {job.newFiles > 0 && (
                      <span className="text-teal-600"> +{job.newFiles}</span>
                    )}
                    {job.failedFiles > 0 && (
                      <span className="text-red-600"> fail {job.failedFiles}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-slate-500">
                    {formatDurationMs(job.durationMs)}
                  </td>
                  <td className="py-2 max-w-[200px]">
                    <span className="font-mono text-[10px] text-slate-400">
                      {job.id}
                    </span>
                    {job.errorMessage && (
                      <p className="mt-0.5 truncate text-red-600">
                        {job.errorMessage}
                      </p>
                    )}
                    {job.currentFile && job.status === "RUNNING" && (
                      <p className="mt-0.5 truncate text-slate-400">
                        {job.currentFile}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <RefreshCw size={18} />
            </div>
            <div>
              <h2 className="section-title">Sync cloud</h2>
              <p className="text-xs text-slate-500">
                Cek cloud, download, dan OCR. Batch, folder root, dan retry
                memakai pengaturan server (tidak perlu diatur manual).
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-4 rounded-lg border px-4 py-4",
              settings.autoScanEnabled
                ? "border-teal-200 bg-teal-50/60"
                : "border-slate-200 bg-slate-50/60"
            )}
          >
            <div>
              <p className="text-sm font-medium text-slate-800">
                Sync otomatis
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Aktifkan: sync semua user sekarang (tanpa batas batch), lalu
                ulang sesuai interval. Matikan: hentikan jadwal, batalkan job
                aktif, bersihkan antrean.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoScanEnabled}
              disabled={savingScan}
              onClick={() => void toggleAutoSync()}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                settings.autoScanEnabled ? "bg-teal-600" : "bg-slate-300",
                savingScan && "opacity-60"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                  settings.autoScanEnabled && "translate-x-5"
                )}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-xs text-slate-600 min-w-[140px]">
              Interval sync (menit)
              <input
                type="number"
                min={5}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={intervalInput}
                onChange={(e) => setIntervalInput(e.target.value)}
                disabled={savingScan}
              />
            </label>
            <button
              type="button"
              disabled={savingScan}
              onClick={() =>
                void saveSettings({
                  autoScanIntervalMinutes: Number(intervalInput),
                })
              }
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              Simpan interval
            </button>
          </div>

          <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-500">Jadwal</dt>
              <dd>
                {schedulerActive ? "Aktif" : "Nonaktif"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Terakhir jalan</dt>
              <dd>
                {settings.autoScanLastRunAt
                  ? new Date(settings.autoScanLastRunAt).toLocaleString("id-ID")
                  : "-"}
              </dd>
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}
