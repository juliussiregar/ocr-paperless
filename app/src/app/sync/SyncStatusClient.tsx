"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DocPreviewLink } from "@/components/DocPreviewLink";

type SyncFileRow = {
  id: string;
  remotePath: string;
  fileName: string;
  syncStatus: string;
  paperlessDocumentId: number | null;
  errorMessage: string | null;
  fileSize: number | null;
  lastSyncedAt: string | null;
  updatedAt: string;
};

type ScanJobRow = {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
  newFiles: number;
  skippedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  createdAt: string;
  triggeredBy: { name: string; email: string } | null;
};

const STATUS_BADGE: Record<string, string> = {
  OCR_DONE: "badge-teal",
  SKIPPED: "badge-slate",
  OCR_PENDING: "badge-blue",
  QUEUED: "badge-blue",
  DOWNLOADING: "badge-amber",
  FAILED: "badge-amber",
  DISCOVERED: "badge-slate",
};

export function SyncStatusPanel() {
  const [files, setFiles] = useState<SyncFileRow[]>([]);
  const [stats, setStats] = useState<Array<{ syncStatus: string; _count: number }>>([]);
  const [jobs, setJobs] = useState<ScanJobRow[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter ? `?status=${filter}` : "";
      const res = await fetch(`/api/sync-files${qs}`);
      const data = await res.json();
      if (res.ok) {
        setFiles(data.files ?? []);
        setStats(data.stats ?? []);
        setJobs(data.recentJobs ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const statCount = (s: string) =>
    stats.find((x) => x.syncStatus === s)?._count ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Selesai OCR", key: "OCR_DONE", icon: CheckCircle2, color: "text-teal-600" },
          { label: "Menunggu OCR", key: "OCR_PENDING", icon: Clock, color: "text-blue-600" },
          { label: "Gagal", key: "FAILED", icon: XCircle, color: "text-amber-600" },
          { label: "Dilewati", key: "SKIPPED", icon: FileText, color: "text-slate-500" },
        ].map(({ label, key, icon: Icon, color }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(filter === key ? "" : key)}
            className={cn(
              "card card-hover p-4 text-left transition",
              filter === key && "ring-2 ring-teal-500"
            )}
          >
            <Icon className={cn("mb-2", color)} size={18} />
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-xl font-bold tabular-nums">{statCount(key)}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {total} file {filter ? `(filter: ${filter})` : ""}
        </p>
        <button type="button" onClick={load} className="btn btn-secondary !py-2">
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">
                  File & lokasi folder
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Ukuran</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto animate-spin" size={20} />
                  </td>
                </tr>
              )}
              {!loading && files.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    Belum ada file tersinkron
                  </td>
                </tr>
              )}
              {files.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    {f.paperlessDocumentId ? (
                      <DocPreviewLink
                        docId={f.paperlessDocumentId}
                        className="block font-medium text-slate-800"
                      >
                        {f.fileName}
                      </DocPreviewLink>
                    ) : (
                      <p className="font-medium text-slate-800">{f.fileName}</p>
                    )}
                    <p
                      className="max-w-md truncate text-[11px] text-slate-500"
                      title={f.remotePath}
                    >
                      {f.remotePath}
                    </p>
                    {f.errorMessage && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                        <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        {f.errorMessage}
                      </p>
                    )}
                    {f.paperlessDocumentId && (
                      <div className="mt-1 flex gap-2">
                        <a
                          href={`/api/documents/${f.paperlessDocumentId}/preview`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-medium text-teal-700 hover:underline"
                        >
                          Preview
                        </a>
                        <a
                          href={`/api/documents/${f.paperlessDocumentId}/download`}
                          className="text-[11px] font-medium text-teal-700 hover:underline"
                        >
                          Unduh
                        </a>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", STATUS_BADGE[f.syncStatus] ?? "badge-slate")}>
                      {f.syncStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">
                    {f.fileSize != null
                      ? `${(f.fileSize / 1024 / 1024).toFixed(2)} MB`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(f.updatedAt).toLocaleString("id-ID")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="section-title">Riwayat Scan (10 terakhir)</h3>
        </div>
        <ul className="divide-y divide-slate-50">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
            >
              <div>
                <span
                  className={cn(
                    "badge mr-2",
                    j.status === "COMPLETED"
                      ? "badge-teal"
                      : j.status === "FAILED"
                        ? "badge-amber"
                        : "badge-blue"
                  )}
                >
                  {j.status}
                </span>
                <span className="text-slate-600">
                  Baru {j.newFiles} · Skip {j.skippedFiles} · Gagal {j.failedFiles}
                </span>
                {j.triggeredBy && (
                  <span className="ml-2 text-xs text-slate-400">
                    oleh {j.triggeredBy.name}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400">
                {new Date(j.createdAt).toLocaleString("id-ID")}
              </span>
            </li>
          ))}
          {jobs.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-slate-400">
              Belum ada scan
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
