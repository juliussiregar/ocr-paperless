"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  CheckCircle2,
  SkipForward,
  AlertCircle,
  FilePlus,
  Square,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu antrean...",
  RUNNING: "Memindai cloud...",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  CANCELLED: "Dihentikan",
};

type JobProgress = {
  id?: string;
  status: string;
  processedFiles: number;
  totalFiles: number;
  skippedFiles: number;
  newFiles: number;
  failedFiles: number;
  errorMessage?: string | null;
};

interface ScanButtonProps {
  initialJob?: JobProgress | null;
}

export function ScanButton({ initialJob }: ScanButtonProps) {
  const initialActive =
    initialJob?.status === "RUNNING" || initialJob?.status === "PENDING";

  const [loading, setLoading] = useState(!!initialActive);
  const [cancelling, setCancelling] = useState(false);
  const [jobId, setJobId] = useState<string | null>(initialJob?.id ?? null);
  const [progress, setProgress] = useState<JobProgress | null>(
    initialJob ?? null
  );
  const router = useRouter();

  useEffect(() => {
    if (initialActive && initialJob?.id) {
      pollJob(initialJob.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollJob(id: string) {
    const res = await fetch(`/api/scan/${id}`);
    if (!res.ok) return;
    const job = await res.json();
    setProgress(job);
    setJobId(id);

    if (job.status === "RUNNING" || job.status === "PENDING") {
      setLoading(true);
      setTimeout(() => pollJob(id), 2000);
    } else {
      setLoading(false);
      setCancelling(false);
      router.refresh();
      if (job.status === "COMPLETED") {
        showToast(
          `${job.newFiles} dokumen baru siap dicari · ${job.skippedFiles} dilewati`,
          "success"
        );
      } else if (job.status === "FAILED") {
        showToast(
          job.errorMessage ??
            "Scan gagal. Coba lagi atau periksa kredensial cloud",
          "error"
        );
      } else if (job.status === "CANCELLED") {
        showToast("Scan dihentikan", "success");
      }
    }
  }

  async function handleScan() {
    setLoading(true);
    setCancelling(false);
    setProgress(null);

    const res = await fetch("/api/scan", { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      if (data.jobId) {
        setJobId(data.jobId);
        setLoading(true);
        pollJob(data.jobId);
        showToast("Scan sudah berjalan. Menampilkan progress", "success");
      } else {
        setLoading(false);
        showToast(data.error ?? "Gagal memulai scan", "error");
      }
      return;
    }

    showToast("Scan dimulai. Mengambil dokumen dari cloud", "success");
    setJobId(data.jobId);
    pollJob(data.jobId);
  }

  async function handleStop() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    const res = await fetch(`/api/scan/${jobId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCancelling(false);
      showToast(data.error ?? "Gagal menghentikan scan", "error");
      return;
    }
    setProgress((p) =>
      p ? { ...p, status: "CANCELLED", ...data } : { ...data, status: "CANCELLED" }
    );
    showToast("Menghentikan scan...", "success");
    // Keep polling until worker acknowledges cancel
    pollJob(jobId);
  }

  const isActive =
    loading ||
    progress?.status === "RUNNING" ||
    progress?.status === "PENDING";

  const isDiscovering =
    isActive && (progress?.totalFiles ?? 0) === 0;

  const pct =
    progress && progress.totalFiles > 0
      ? Math.round((progress.processedFiles / progress.totalFiles) * 100)
      : 0;

  const isDone = progress?.status === "COMPLETED";
  const isStopped = progress?.status === "CANCELLED";

  return (
    <div className="w-full space-y-3 sm:w-auto sm:min-w-[300px]">
      <div className="flex gap-2">
        <button
          onClick={handleScan}
          disabled={isActive}
          className="btn btn-primary flex-1 sm:flex-none"
        >
          <RefreshCw size={16} className={cn(isActive && "animate-spin")} />
          {isActive ? "Memindai..." : "Scan Sekarang"}
        </button>
        {isActive && jobId && (
          <button
            type="button"
            onClick={handleStop}
            disabled={cancelling}
            className="btn !bg-red-600 !text-white hover:!bg-red-700 disabled:opacity-70"
            title="Hentikan scan"
          >
            {cancelling ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Square size={14} fill="currentColor" />
            )}
            {cancelling ? "Menghentikan..." : "Stop"}
          </button>
        )}
      </div>

      {progress && (
        <div className="animate-slide-up rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span
              className={cn(
                "badge",
                isDone
                  ? "badge-teal"
                  : isStopped
                    ? "badge-slate"
                    : progress.status === "FAILED"
                      ? "badge-amber"
                      : "badge-blue"
              )}
            >
              {STATUS_LABEL[progress.status] ?? progress.status}
            </span>
            {progress.totalFiles > 0 ? (
              <span className="text-xs font-semibold tabular-nums text-slate-500">
                {progress.processedFiles}/{progress.totalFiles}
              </span>
            ) : isActive ? (
              <span className="text-xs text-slate-500">
                {progress.processedFiles > 0
                  ? `${progress.processedFiles} PDF ditemukan...`
                  : "Menghubungkan ke cloud..."}
              </span>
            ) : null}
          </div>

          {isDiscovering && (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Sedang menelusuri folder Cloud Bappenas. Tekan{" "}
              <strong>Stop</strong> untuk menghentikan.
            </p>
          )}

          {progress.totalFiles > 0 && (
            <div className="mb-3">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700 ease-out",
                    isDone
                      ? "bg-gradient-to-r from-teal-500 to-teal-400"
                      : "bg-gradient-to-r from-teal-600 to-blue-500"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-right text-[10px] font-medium tabular-nums text-slate-400">
                {pct}%
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <StatPill
              icon={<FilePlus size={12} />}
              label="Baru"
              value={progress.newFiles}
              color="teal"
            />
            <StatPill
              icon={<SkipForward size={12} />}
              label="Dilewati"
              value={progress.skippedFiles}
              color="slate"
            />
            <StatPill
              icon={<AlertCircle size={12} />}
              label="Gagal"
              value={progress.failedFiles}
              color="amber"
            />
          </div>

          {isDone && (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-teal-700">
              <CheckCircle2 size={14} />
              Selesai. Dokumen baru siap dicari
            </p>
          )}
          {isStopped && (
            <p className="mt-3 text-xs font-medium text-slate-600">
              Scan dihentikan. Anda bisa mulai scan lagi kapan saja.
            </p>
          )}
          {progress.status === "FAILED" && progress.errorMessage && (
            <p className="mt-3 text-xs text-amber-700">{progress.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "teal" | "slate" | "amber";
}) {
  const colors = {
    teal: "text-teal-700 bg-teal-50 ring-1 ring-teal-100",
    slate: "text-slate-600 bg-slate-50 ring-1 ring-slate-100",
    amber: "text-amber-700 bg-amber-50 ring-1 ring-amber-100",
  };
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg px-2 py-2",
        colors[color]
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <span className="text-lg font-bold tabular-nums">{value}</span>
    </div>
  );
}
