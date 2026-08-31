"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Server } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";

interface AutoScanSettings {
  autoScanEnabled: boolean;
  autoScanReady: boolean;
  autoScanIntervalMinutes: number;
  autoScanBatchSize: number;
  autoScanRootPath: string;
  autoScanSubtrees: string;
  autoRetryEnabled: boolean;
  autoRetryIntervalMinutes: number;
  autoRetryBatchSize: number;
  autoScanLastRunAt: string | null;
  envForceEnabled?: boolean;
}

interface BacklogRow {
  userId: string;
  email: string;
  name: string | null;
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
  const [batchInput, setBatchInput] = useState(
    String(initialSettings.autoScanBatchSize)
  );
  const [rootInput, setRootInput] = useState(initialSettings.autoScanRootPath);
  const [subtreesInput, setSubtreesInput] = useState(
    initialSettings.autoScanSubtrees ?? ""
  );
  const [retryIntervalInput, setRetryIntervalInput] = useState(
    String(initialSettings.autoRetryIntervalMinutes ?? 120)
  );
  const [retryBatchInput, setRetryBatchInput] = useState(
    String(initialSettings.autoRetryBatchSize ?? 30)
  );
  const [backlog, setBacklog] = useState<BacklogRow[]>([]);
  const [scanHealth, setScanHealth] = useState<ScanHealth | null>(null);
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [triggeringUserId, setTriggeringUserId] = useState<string | null>(null);
  const [releasingLockUserId, setReleasingLockUserId] = useState<string | null>(
    null
  );

  function showMsg(text: string, type: "success" | "error" = "success") {
    showToast(text, type);
  }

  async function saveSettings(patch: Record<string, unknown>) {
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
        return;
      }
      setSettings(data.settings);
      setIntervalInput(String(data.settings.autoScanIntervalMinutes));
      setBatchInput(String(data.settings.autoScanBatchSize));
      setRootInput(data.settings.autoScanRootPath);
      setSubtreesInput(data.settings.autoScanSubtrees ?? "");
      setRetryIntervalInput(String(data.settings.autoRetryIntervalMinutes));
      setRetryBatchInput(String(data.settings.autoRetryBatchSize));
      showMsg("Pengaturan auto scan disimpan");
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
          rootPath: settings.autoScanRootPath,
          limit: settings.autoScanBatchSize,
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

  const schedulerActive =
    settings.autoScanReady &&
    (settings.autoScanEnabled || settings.envForceEnabled);

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
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          triggeringUserId === row.userId || row.activeJob != null
                        }
                        onClick={() => void triggerDelta(row.userId)}
                        className="rounded border border-teal-200 px-2 py-1 text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                      >
                        Delta
                      </button>
                      <button
                        type="button"
                        disabled={
                          triggeringUserId === row.userId || row.activeJob != null
                        }
                        onClick={() => void triggerDelta(row.userId, true)}
                        className="rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reconcile
                      </button>
                    </div>
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
              <h2 className="section-title">Auto scan</h2>
              <p className="text-xs text-slate-500">
                Delta sync dari cloud root (tidak pakai folder favorit). Default
                nonaktif sampai ditandai siap.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Aktifkan auto download hanya setelah uji delta sync di staging.
            Tandai <strong>Siap deploy</strong> lalu nyalakan toggle jadwal.
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Siap deploy</p>
              <p className="mt-1 text-xs text-slate-500">
                Wajib true sebelum scheduler jalan (kecuali dipaksa env).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoScanReady}
              disabled={savingScan}
              onClick={() =>
                void saveSettings({ autoScanReady: !settings.autoScanReady })
              }
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                settings.autoScanReady ? "bg-teal-600" : "bg-slate-300",
                savingScan && "opacity-60"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                  settings.autoScanReady && "translate-x-5"
                )}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">
                Jadwal auto scan
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Job delta_sync per user (rotate by last discovery).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoScanEnabled}
              disabled={savingScan || !settings.autoScanReady}
              onClick={() =>
                void saveSettings({
                  autoScanEnabled: !settings.autoScanEnabled,
                })
              }
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                settings.autoScanEnabled ? "bg-teal-600" : "bg-slate-300",
                (savingScan || !settings.autoScanReady) && "opacity-60"
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

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-xs text-slate-600">
              Interval (menit)
              <input
                type="number"
                min={5}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={intervalInput}
                onChange={(e) => setIntervalInput(e.target.value)}
                disabled={savingScan}
              />
            </label>
            <label className="block text-xs text-slate-600">
              Batch ingest (file/job)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                disabled={savingScan}
              />
            </label>
            <label className="block text-xs text-slate-600">
              Cloud root path
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                placeholder="/"
                disabled={savingScan}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={savingScan}
            onClick={() =>
              void saveSettings({
                autoScanIntervalMinutes: Number(intervalInput),
                autoScanBatchSize: Number(batchInput),
                autoScanRootPath: rootInput,
                autoScanSubtrees: subtreesInput,
                autoRetryIntervalMinutes: Number(retryIntervalInput),
                autoRetryBatchSize: Number(retryBatchInput),
              })
            }
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            Simpan interval / batch / root / subtree
          </button>

          <label className="block text-xs text-slate-600">
            Subtree rotation (JSON array path, opsional)
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
              rows={2}
              value={subtreesInput}
              onChange={(e) => setSubtreesInput(e.target.value)}
              placeholder='["/folder-a","/folder-b"]'
              disabled={savingScan}
            />
          </label>

          <div className="rounded-lg border border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Auto retry FAILED
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Scheduler terpisah: re-queue file gagal ke ingest queue.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoRetryEnabled}
                disabled={savingScan || !settings.autoScanReady}
                onClick={() =>
                  void saveSettings({
                    autoRetryEnabled: !settings.autoRetryEnabled,
                  })
                }
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                  settings.autoRetryEnabled ? "bg-teal-600" : "bg-slate-300",
                  (savingScan || !settings.autoScanReady) && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                    settings.autoRetryEnabled && "translate-x-5"
                  )}
                />
              </button>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs text-slate-600">
                Interval retry (menit)
                <input
                  type="number"
                  min={15}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={retryIntervalInput}
                  onChange={(e) => setRetryIntervalInput(e.target.value)}
                  disabled={savingScan}
                />
              </label>
              <label className="block text-xs text-slate-600">
                Batch retry (file)
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={retryBatchInput}
                  onChange={(e) => setRetryBatchInput(e.target.value)}
                  disabled={savingScan}
                />
              </label>
            </div>
          </div>

          <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-500">Scheduler</dt>
              <dd>
                {schedulerActive ? "Aktif" : "Nonaktif"}
                {settings.envForceEnabled && (
                  <span className="ml-1 text-amber-700">
                    (env AUTO_SCAN_ENABLED)
                  </span>
                )}
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
