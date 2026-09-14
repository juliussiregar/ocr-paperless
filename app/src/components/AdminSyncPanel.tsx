"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";

const POLL_MS = 2500;

interface AutoScanSettings {
  autoScanEnabled: boolean;
  autoScanIntervalMinutes: number;
  autoScanLastRunAt: string | null;
}

interface LiveJob {
  id: string;
  jobType: string;
  status: string;
  phase: string | null;
  phaseLabel: string;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  newFiles: number;
  currentFile: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt?: string | null;
  createdAt?: string;
  durationMs?: number | null;
  progressPct: number | null;
  user: { id?: string; email: string; name?: string | null } | null;
}

interface LiveUser {
  userId: string;
  email: string;
  lastDiscoveryAt: string | null;
  ocrDone: number;
  ocrPending: number;
  downloading: number;
  failed: number;
  warnings: number;
  failedRetryable: number;
  failedExhausted: number;
  scan?: {
    cloudFound: number;
    needsIngest: number;
    unchanged: number;
    stillToDownload: number;
    downloaded: number;
    ocrPending: number;
    ocrDoneSinceScan: number;
    duplicates: number;
    skippedOther: number;
    scanned: number;
    downloadPct: number | null;
    ocrPct: number | null;
  };
  activeJob: {
    id: string;
    jobType: string;
    status: string;
    phase: string | null;
    phaseLabel: string;
    totalFiles: number;
    processedFiles: number;
    progressPct: number | null;
    currentFile: string | null;
    startedAt: string | null;
    errorMessage: string | null;
  } | null;
}

interface LiveHealth {
  queues: {
    discover: { waiting: number; active: number; delayed: number; failed: number };
    ingest: { waiting: number; active: number; delayed: number; failed: number };
  };
  redis: { usedMemoryHuman: string; maxMemoryHuman: string };
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
}

interface LivePayload {
  at: string;
  settings: AutoScanSettings;
  batchSize: number;
  batchUnlimited: boolean;
  credsUserCount: number;
  emptyFileWarning: { message: string; count: number };
  failedBreakdown: Array<{ errorMessage: string; count: number }>;
  pipeline: {
    ocrDone: number;
    ocrPending: number;
    queued: number;
    downloading: number;
    discovered: number;
    failed: number;
    warnings: number;
    skipped: number;
    deleted: number;
    embedPending: number;
  };
  scanTotals?: {
    cloudFound: number;
    needsIngest: number;
    unchanged: number;
    stillToDownload: number;
    downloaded: number;
    scanned: number;
    duplicates: number;
    downloadPct: number | null;
    ocrPct: number | null;
  };
  health: LiveHealth;
  activeJobs: LiveJob[];
  recentJobs: LiveJob[];
  users: LiveUser[];
}

type PipelineStage = "discover" | "download" | "ocr" | "embed" | "idle";

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function jobTypeLabel(jobType: string): string {
  switch (jobType) {
    case "delta_sync":
      return "Sync cloud";
    case "reconcile_only":
      return "Cek status OCR";
    case "ingest_paths":
      return "Unduh file";
    default:
      return jobType;
  }
}

/**
 * Progress labels differ by job type:
 * - Sync cloud: files found / need ingest (not batch 750)
 * - Unduh file: download batch progress
 */
function formatJobProgress(job: {
  jobType: string;
  status: string;
  phase: string | null;
  processedFiles: number;
  totalFiles: number;
  skippedFiles?: number;
  newFiles?: number;
}): string {
  if (job.jobType === "ingest_paths") {
    if (job.totalFiles > 0) {
      return `unduh ${job.processedFiles}/${job.totalFiles}`;
    }
    return job.processedFiles > 0 ? `unduh ${job.processedFiles}` : "-";
  }

  if (job.jobType === "delta_sync" || job.jobType === "reconcile_only") {
    if (job.status === "RUNNING" || job.status === "PENDING" || job.status === "PAUSED") {
      if (job.phase === "queue") return "drain antrian";
      if (job.processedFiles > 0) return `${job.processedFiles} file ketemu`;
      return "sedang scan";
    }
    // Completed sync: processedFiles = cloud found, totalFiles = needs ingest
    // Legacy rows often stored 0/750 (batch cap) which looked like "0 of 750 done".
    if (job.processedFiles === 0 && job.totalFiles > 0) {
      return `siap unduh ~${job.totalFiles} (batch)`;
    }
    if (job.processedFiles > 0 && job.totalFiles > 0) {
      return `${job.processedFiles} ketemu · ${job.totalFiles} perlu unduh`;
    }
    if (job.processedFiles > 0) {
      return `${job.processedFiles} ketemu`;
    }
    return "-";
  }

  if (job.totalFiles > 0) {
    return `${job.processedFiles}/${job.totalFiles}`;
  }
  return job.processedFiles > 0 ? String(job.processedFiles) : "-";
}

function isFailureNote(status: string, message: string | null): boolean {
  if (!message) return false;
  if (status === "FAILED") return true;
  if (status === "CANCELLED") return true;
  return false;
}

function ProgressTrack({
  label,
  current,
  total,
  variant = "teal",
  hint,
}: {
  label: string;
  current: number;
  total: number | null;
  variant?: "teal" | "violet";
  hint?: string;
}) {
  const pct =
    total != null && total > 0
      ? Math.min(100, Math.round((current / total) * 100))
      : null;
  const barColor = variant === "violet" ? "bg-violet-500" : "bg-teal-500";

  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>
          {label}
          {total != null ? (
            <span className="tabular-nums">
              {" "}
              {current}/{total}
            </span>
          ) : (
            <span className="tabular-nums"> {current}</span>
          )}
        </span>
        {pct != null && <span className="tabular-nums">{pct}%</span>}
      </div>
      {pct != null && (
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              barColor
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function inferStage(data: LivePayload): PipelineStage {
  const h = data.health;
  const discoverBusy =
    h.queues.discover.active > 0 ||
    h.queues.discover.waiting > 0 ||
    data.activeJobs.some(
      (j) =>
        j.jobType === "delta_sync" &&
        j.status === "RUNNING" &&
        (j.phase === "discovering" ||
          j.phase === "starting" ||
          j.phase === "queue")
    );
  if (discoverBusy) return "discover";

  const downloadBusy =
    h.queues.ingest.active > 0 ||
    h.queues.ingest.waiting > 0 ||
    data.pipeline.downloading > 0 ||
    data.pipeline.discovered > 0 ||
    data.activeJobs.some(
      (j) =>
        j.jobType === "ingest_paths" ||
        j.phase === "downloading" ||
        (j.jobType === "delta_sync" && j.phase === "downloading")
    );
  if (downloadBusy) return "download";

  if (data.pipeline.ocrPending > 0 || data.pipeline.queued > 0) return "ocr";
  if (data.pipeline.embedPending > 0) return "embed";
  return "idle";
}

interface AdminSyncPanelProps {
  initialSettings: AutoScanSettings;
}

export function AdminSyncPanel({ initialSettings }: AdminSyncPanelProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [savingScan, setSavingScan] = useState(false);
  const [intervalInput, setIntervalInput] = useState(
    String(initialSettings.autoScanIntervalMinutes)
  );
  const [triggeringUserId, setTriggeringUserId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function showMsg(text: string, type: "success" | "error" = "success") {
    showToast(text, type);
  }

  const pollLive = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sync/live", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setPollError(data.error ?? "Gagal memuat status live");
        return;
      }
      setLive(data as LivePayload);
      setSettings(data.settings);
      setIntervalInput(String(data.settings.autoScanIntervalMinutes));
      setPollError(null);
    } catch {
      setPollError("Koneksi ke server gagal");
    }
  }, []);

  useEffect(() => {
    void pollLive();
    pollRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        void pollLive();
      }
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollLive]);

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
      if (!options?.silent) showMsg("Pengaturan sync disimpan");
      void pollLive();
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
      void pollLive();

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
          `Sync otomatis aktif. ${enqueued} job dibuat sekarang.${skipped > 0 ? ` ${skipped} user dilewati (job aktif).` : ""}`
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

  async function triggerSync(userId: string, reconcileOnly = false) {
    setTriggeringUserId(reconcileOnly ? `${userId}:cek` : userId);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reconcileOnly }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal memulai sync", "error");
        return;
      }
      showMsg(
        reconcileOnly
          ? `Cek status OCR dimulai (job ${data.jobId})`
          : `Sync cloud dimulai (job ${data.jobId})`
      );
      void pollLive();
    } finally {
      setTriggeringUserId(null);
    }
  }

  async function triggerAllSync(reconcileOnly = false) {
    const key = reconcileOnly ? "all-cek" : "all-sync";
    setTriggeringUserId(key);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "triggerAll", reconcileOnly }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal memulai sync semua user", "error");
        return;
      }
      const n = data.enqueued?.length ?? 0;
      const skipped = data.skippedActive?.length ?? 0;
      showMsg(
        reconcileOnly
          ? `Cek status OCR: ${n} user job dibuat${skipped > 0 ? `, ${skipped} dilewati (job aktif)` : ""}`
          : `Sync cloud: ${n} user job dibuat${skipped > 0 ? `, ${skipped} dilewati (job aktif)` : ""}`
      );
      void pollLive();
    } finally {
      setTriggeringUserId(null);
    }
  }

  async function retryFailed(userId?: string, allUsers = false) {
    const key = allUsers ? "all" : userId ?? "";
    setRetryingId(key);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retryFailed",
          allUsers,
          userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal retry failed", "error");
        return;
      }
      if (allUsers) {
        const n = data.enqueued?.length ?? 0;
        showMsg(
          n > 0
            ? `Retry manual: ${n} user, job dibuat (max ${batchLabel}/user)`
            : "Tidak ada file gagal untuk diulang"
        );
      } else {
        showMsg(
          `Retry ${data.totalFiles ?? 0} file gagal, job ${data.jobId ?? ""}`
        );
      }
      void pollLive();
    } finally {
      setRetryingId(null);
    }
  }

  const stage = live ? inferStage(live) : "idle";
  const health = live?.health;
  const pipeline = live?.pipeline;
  const batchLabel = live?.batchUnlimited
    ? "tanpa batas"
    : String(live?.batchSize ?? 750);

  const stages: Array<{
    key: PipelineStage;
    label: string;
    count: number;
    hint: string;
  }> = [
    {
      key: "discover",
      label: "1. Discover",
      count:
        (health?.queues.discover.active ?? 0) +
        (health?.queues.discover.waiting ?? 0) +
        (pipeline?.discovered ?? 0),
      hint: "Scan folder cloud",
    },
    {
      key: "download",
      label: "2. Unduh",
      count:
        (pipeline?.downloading ?? 0) +
        (pipeline?.discovered ?? 0) +
        (health?.queues.ingest.active ?? 0),
      hint: "Download + kirim ke Paperless",
    },
    {
      key: "ocr",
      label: "3. OCR",
      count: (pipeline?.ocrPending ?? 0) + (pipeline?.queued ?? 0),
      hint: "Paperless memproses OCR",
    },
    {
      key: "embed",
      label: "4. Embed",
      count: pipeline?.embedPending ?? 0,
      hint: "Indeks untuk Tanya Arsip",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
            pollError ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-700"
          )}
        >
          <Radio
            size={12}
            className={cn(!pollError && "animate-pulse")}
          />
          {pollError ? pollError : "Live"}
        </span>
        {live?.at && (
          <span>Update {new Date(live.at).toLocaleTimeString("id-ID")}</span>
        )}
        <span className="text-slate-400">poll {POLL_MS / 1000}s</span>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <RefreshCw size={18} />
            </div>
            <div>
              <h2 className="section-title">Sync cloud</h2>
              <p className="text-xs text-slate-500">
                Batch {batchLabel} file per job, lanjut otomatis sampai habis.
                {live?.credsUserCount != null && (
                  <span> {live.credsUserCount} user dengan kredensial.</span>
                )}
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
              <p className="text-sm font-medium text-slate-800">Sync otomatis</p>
              <p className="mt-1 text-xs text-slate-600">
                Aktifkan: sync semua user sekarang (batch {batchLabel}, kejar
                sampai habis), lalu ulang tiap interval. Matikan: hentikan
                jadwal, batalkan job aktif, bersihkan antrean.
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
            <label className="block min-w-[140px] text-xs text-slate-600">
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
              <dd>{settings.autoScanEnabled ? "Aktif" : "Nonaktif"}</dd>
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

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <Activity size={18} />
            </div>
            <div>
              <h2 className="section-title">Progress dari hasil scan</h2>
              <p className="text-xs text-slate-500">
                Patokan: file yang perlu unduh/OCR setelah scan interval
                terakhir. Folder tidak berubah di-skip.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-4 sm:p-6">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-500">Ketemu di cloud</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {live?.scanTotals?.cloudFound ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-500">Perlu unduh / OCR</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {live?.scanTotals?.needsIngest ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-500">Sudah sama (skip)</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {live?.scanTotals?.unchanged ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <dt className="text-xs text-slate-500">Duplikat konten</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {live?.scanTotals?.duplicates ?? 0}
              </dd>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Di-skip, tanpa OCR ulang
              </p>
            </div>
          </dl>

          <ProgressTrack
            label="Unduh (dari hasil scan)"
            current={live?.scanTotals?.downloaded ?? 0}
            total={live?.scanTotals?.needsIngest ?? null}
            variant="teal"
            hint={
              (live?.scanTotals?.stillToDownload ?? 0) > 0
                ? `Sisa antrian unduh: ${live?.scanTotals?.stillToDownload}`
                : "Antrian unduh kosong"
            }
          />
          <ProgressTrack
            label="Sudah discan / OCR (termasuk duplikat)"
            current={live?.scanTotals?.scanned ?? 0}
            total={live?.scanTotals?.needsIngest ?? null}
            variant="violet"
            hint={
              (live?.scanTotals?.duplicates ?? 0) > 0
                ? `OCR baru + duplikat yang dipakai ulang`
                : "OCR selesai sejak scan terakhir"
            }
          />
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Activity size={18} />
            </div>
            <div>
              <h2 className="section-title">Tahapan pipeline</h2>
              <p className="text-xs text-slate-500">
                Highlight menandai tahap yang sedang aktif. OCR selesai (semua
                waktu): {pipeline?.ocrDone ?? 0} file.
              </p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {stages.map((s, i) => (
            <div key={s.key} className="relative">
              {i > 0 && (
                <span
                  className="absolute -left-2 top-1/2 hidden h-px w-3 -translate-y-1/2 bg-slate-200 lg:block"
                  aria-hidden
                />
              )}
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 transition",
                  stage === s.key
                    ? "border-teal-300 bg-teal-50 ring-2 ring-teal-200"
                    : "border-slate-100 bg-slate-50"
                )}
              >
                <p className="text-xs font-medium text-slate-700">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {s.count}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{s.hint}</p>
                {stage === s.key && (
                  <p className="mt-1 text-[10px] font-medium text-teal-700">
                    Aktif sekarang
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        {stage === "idle" && live && live.activeJobs.length === 0 && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Tidak ada aktivitas sync. Aktifkan toggle atau trigger delta manual.
          </p>
        )}
      </Card>

      {(pipeline?.warnings ?? 0) > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="section-title">
              Peringatan file kosong ({pipeline?.warnings ?? 0})
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {live?.emptyFileWarning?.message ??
                "File 0 byte tidak bisa di-OCR. Perbaiki atau ganti file di Cloud Bappenas."}
            </p>
          </div>
          <div className="px-6 py-4 text-xs text-slate-600">
            <p>
              File ini dilewati (status SKIPPED), bukan gagal. Tidak perlu
              retry. Setelah file diperbaiki di cloud, trigger delta sync lagi.
            </p>
          </div>
        </Card>
      )}

      {(pipeline?.failed ?? 0) > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="section-title">
                  File gagal ({pipeline?.failed ?? 0})
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Auto-retry worker: 1x per file. Sisanya retry manual di sini
                  (max {batchLabel} per batch).
                </p>
              </div>
              <button
                type="button"
                disabled={retryingId !== null}
                onClick={() => void retryFailed(undefined, true)}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <RotateCcw size={14} />
                Retry semua gagal
              </button>
            </div>
          </div>
          <div className="px-6 py-4">
            <ul className="space-y-2 text-xs text-slate-600">
              {live?.failedBreakdown?.map((row) => (
                <li
                  key={row.errorMessage}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">{row.errorMessage}</span>
                  <span className="shrink-0 tabular-nums font-medium text-slate-800">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Error jaringan (503) atau unduh timeout bisa dicoba retry manual.
              File kosong (0 byte) sudah dipindah ke peringatan di atas.
            </p>
          </div>
        </Card>
      )}

      {live && live.activeJobs.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="section-title">Job aktif ({live.activeJobs.length})</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {live.activeJobs.map((job) => {
              const userStats = live.users?.find(
                (u) =>
                  u.userId === job.user?.id ||
                  u.email === job.user?.email
              );
              const scan = userStats?.scan;
              const showDiscover =
                job.phase === "discovering" ||
                job.phase === "starting" ||
                (job.jobType === "delta_sync" && job.phase !== "queue");
              const showScanProgress =
                (scan?.needsIngest ?? 0) > 0 ||
                job.jobType === "ingest_paths" ||
                job.phase === "queue";

              return (
              <div key={job.id} className="space-y-3 px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {job.user?.email ?? "Sistem"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {jobTypeLabel(job.jobType)} · {job.phaseLabel}
                    </p>
                    {scan && scan.cloudFound > 0 && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Scan: {scan.cloudFound} ketemu · {scan.needsIngest} perlu
                        proses · {scan.unchanged} sudah sama
                        {scan.duplicates > 0
                          ? ` · ${scan.duplicates} duplikat`
                          : ""}
                      </p>
                    )}
                  </div>
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    {job.status}
                  </span>
                </div>

                <div className="space-y-2">
                  {showDiscover && (
                    <ProgressTrack
                      label="Scan folder cloud"
                      current={job.processedFiles}
                      total={null}
                      variant="teal"
                      hint={
                        job.currentFile
                          ? String(job.currentFile)
                          : "Menghitung file di cloud"
                      }
                    />
                  )}
                  {showScanProgress && (
                    <ProgressTrack
                      label="Unduh dari hasil scan"
                      current={
                        job.jobType === "ingest_paths" && job.totalFiles > 0
                          ? job.processedFiles
                          : (scan?.downloaded ?? 0)
                      }
                      total={
                        job.jobType === "ingest_paths" && job.totalFiles > 0
                          ? job.totalFiles
                          : (scan?.needsIngest ?? null)
                      }
                      variant="teal"
                      hint={
                        scan
                          ? `Sisa antrian ${scan.stillToDownload} · batch job ${job.processedFiles}/${job.totalFiles || "-"}`
                          : undefined
                      }
                    />
                  )}
                  {showScanProgress && (scan?.needsIngest ?? 0) > 0 && (
                    <ProgressTrack
                      label="Discan / OCR (+ duplikat)"
                      current={scan?.scanned ?? 0}
                      total={scan?.needsIngest ?? null}
                      variant="violet"
                      hint={
                        (scan?.duplicates ?? 0) > 0
                          ? `${scan?.ocrDoneSinceScan ?? 0} OCR baru, ${scan?.duplicates} duplikat dipakai ulang`
                          : `${scan?.ocrPending ?? 0} masih antri OCR`
                      }
                    />
                  )}
                </div>

                {job.currentFile && !showDiscover && (
                  <p className="truncate font-mono text-[10px] text-slate-400">
                    {job.currentFile}
                  </p>
                )}
                {job.errorMessage && (
                  <p className="text-xs text-slate-600">{job.errorMessage}</p>
                )}
              </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Server size={18} />
            </div>
            <div>
              <h2 className="section-title">Scan health</h2>
              <p className="text-xs text-slate-500">
                Queue BullMQ, Redis, dan job macet. Pause job lewat worker jika
                perlu hentikan sementara.
              </p>
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Discover queue</p>
            <p className="mt-1 tabular-nums text-slate-800">
              wait {health?.queues.discover.waiting ?? 0} · active{" "}
              {health?.queues.discover.active ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Ingest queue</p>
            <p className="mt-1 tabular-nums text-slate-800">
              wait {health?.queues.ingest.waiting ?? 0} · active{" "}
              {health?.queues.ingest.active ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Pipeline file</p>
            <p className="mt-1 tabular-nums text-slate-800">
              OCR pending {pipeline?.ocrPending ?? 0} · unduh{" "}
              {pipeline?.downloading ?? 0}
            </p>
            <p className="mt-0.5 text-slate-500">
              OCR selesai {pipeline?.ocrDone ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-medium text-slate-600">Redis</p>
            <p className="mt-1 text-slate-800">
              {health?.redis.usedMemoryHuman ?? "-"} /{" "}
              {health?.redis.maxMemoryHuman ?? "-"}
            </p>
          </div>
        </div>
        {health && health.stuckJobs.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="text-xs font-medium text-amber-800">
              Job RUNNING macet ({health.stuckJobs.length})
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {health.stuckJobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded border border-amber-100 bg-amber-50 px-2 py-1"
                >
                  <span className="font-mono text-slate-700">{job.id}</span>
                  {job.userEmail && (
                    <span className="text-slate-500"> · {job.userEmail}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {health?.throughput && (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Throughput worker</p>
            <p className="mt-1 tabular-nums">
              batch {batchLabel} · discover {health.throughput.discoverConcurrency}{" "}
              · ingest {health.throughput.ingestConcurrency} · download{" "}
              {health.throughput.webdavDownloadConcurrency}
            </p>
          </div>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Status per user</h2>
              <p className="mt-1 text-xs text-slate-500">
                <strong>Sync cloud</strong>: scan folder + unduh file baru atau
                berubah. <strong>Cek status OCR</strong>: perbarui status OCR
                yang sudah ada, tanpa unduh file baru.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={triggeringUserId !== null}
                onClick={() => void triggerAllSync(false)}
                className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
              >
                Sync semua user
              </button>
              <button
                type="button"
                disabled={triggeringUserId !== null}
                onClick={() => void triggerAllSync(true)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cek status semua
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Scan / unduh</th>
                <th className="py-2 pr-3">OCR + duplikat</th>
                <th className="py-2 pr-3">Peringatan</th>
                <th className="py-2 pr-3">Failed</th>
                <th className="py-2 pr-3">Job aktif</th>
                <th className="py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {!live?.users?.length && (
                <tr>
                  <td colSpan={7} className="py-4 text-slate-400">
                    Memuat...
                  </td>
                </tr>
              )}
              {live?.users.map((row) => (
                <tr key={row.userId} className="border-b border-slate-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800">{row.email}</div>
                    {row.lastDiscoveryAt && (
                      <div className="text-[10px] text-slate-400">
                        scan{" "}
                        {new Date(row.lastDiscoveryAt).toLocaleString("id-ID")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.scan && row.scan.needsIngest > 0 ? (
                      <div>
                        <div>
                          {row.scan.downloaded}/{row.scan.needsIngest}
                          {row.scan.downloadPct != null
                            ? ` (${row.scan.downloadPct}%)`
                            : ""}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          ketemu {row.scan.cloudFound} · skip {row.scan.unchanged}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.scan && row.scan.needsIngest > 0 ? (
                      <div>
                        <div>
                          {row.scan.scanned}/{row.scan.needsIngest}
                          {row.scan.ocrPct != null
                            ? ` (${row.scan.ocrPct}%)`
                            : ""}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          OCR {row.scan.ocrDoneSinceScan}
                          {row.scan.duplicates > 0
                            ? ` · dup ${row.scan.duplicates}`
                            : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="tabular-nums">{row.ocrDone}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.warnings > 0 ? (
                      <span className="text-amber-700">{row.warnings}</span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.failed}
                    {row.failedRetryable > 0 && (
                      <span className="text-slate-400">
                        {" "}
                        ({row.failedRetryable} auto)
                      </span>
                    )}
                    {row.failedExhausted > 0 && (
                      <span className="text-amber-600">
                        {" "}
                        ({row.failedExhausted} manual)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.activeJob
                      ? `${row.activeJob.phaseLabel} (${formatJobProgress(row.activeJob)})`
                      : "-"}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          triggeringUserId !== null ||
                          row.activeJob != null
                        }
                        onClick={() => void triggerSync(row.userId)}
                        className="rounded border border-teal-200 px-2 py-1 text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                      >
                        Sync cloud
                      </button>
                      <button
                        type="button"
                        disabled={
                          triggeringUserId !== null ||
                          row.activeJob != null
                        }
                        onClick={() => void triggerSync(row.userId, true)}
                        className="rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Cek status OCR
                      </button>
                      <button
                        type="button"
                        disabled={
                          row.failed === 0 ||
                          retryingId !== null ||
                          row.activeJob != null
                        }
                        onClick={() => void retryFailed(row.userId)}
                        className="rounded border border-amber-200 px-2 py-1 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      >
                        Ulang gagal
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
          <h2 className="section-title">Riwayat job</h2>
          <p className="mt-1 text-xs text-slate-500">
            25 job terakhir, diperbarui otomatis.
          </p>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Tipe</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Tahap</th>
                <th className="py-2 pr-3">Progres</th>
                <th className="py-2 pr-3">Durasi</th>
                <th className="py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {!live?.recentJobs?.length && (
                <tr>
                  <td colSpan={8} className="py-4 text-slate-400">
                    Belum ada job
                  </td>
                </tr>
              )}
              {live?.recentJobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3 text-slate-500">
                    {job.createdAt
                      ? new Date(job.createdAt).toLocaleString("id-ID")
                      : "-"}
                  </td>
                  <td className="py-2 pr-3">{job.user?.email ?? "-"}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-700">
                    {jobTypeLabel(job.jobType)}
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
                  <td className="py-2 pr-3 text-slate-600">{job.phaseLabel}</td>
                  <td className="py-2 pr-3 tabular-nums text-slate-600">
                    {formatJobProgress(job)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-slate-500">
                    {formatDurationMs(job.durationMs)}
                  </td>
                  <td className="py-2 max-w-[240px]">
                    {job.currentFile && job.status === "RUNNING" && (
                      <p className="truncate text-slate-400">{job.currentFile}</p>
                    )}
                    {job.errorMessage && (
                      <p
                        className={cn(
                          "truncate",
                          isFailureNote(job.status, job.errorMessage)
                            ? "text-red-600"
                            : "text-slate-500"
                        )}
                      >
                        {job.errorMessage}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
