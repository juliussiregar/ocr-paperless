"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";

interface AutoScanSettings {
  autoScanEnabled: boolean;
  autoScanIntervalMinutes: number;
  autoScanLastRunAt: string | null;
  envForceEnabled?: boolean;
}

interface AdminPanelProps {
  initialSettings: AutoScanSettings;
}

export function AdminPanel({ initialSettings }: AdminPanelProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [savingScan, setSavingScan] = useState(false);

  function showMsg(text: string, type: "success" | "error" = "success") {
    showToast(text, type);
  }

  async function toggleAutoScan(enabled: boolean) {
    setSavingScan(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateSettings",
          autoScanEnabled: enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal menyimpan pengaturan", "error");
        return;
      }
      setSettings(data.settings);
      showMsg(
        enabled
          ? `Auto scan diaktifkan (tiap ${data.settings.autoScanIntervalMinutes ?? 60} menit, folder favorit)`
          : "Auto scan dimatikan"
      );
    } finally {
      setSavingScan(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminAuditPanel />

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <RefreshCw size={18} />
            </div>
            <div>
              <h2 className="section-title">Auto scan</h2>
              <p className="text-xs text-slate-500">
                Default off. Jadwal background tiap{" "}
                {settings.autoScanIntervalMinutes} menit, hanya folder favorit
                user (batch newest).
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                Aktifkan auto scan terjadwal
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Job berjalan di sync-worker (BullMQ), tanpa perlu buka browser.
                User tanpa favorit dilewati. Tip: favoritkan folder kerja spesifik
                agar discovery cepat; batch diatur lewat SCAN_MAX_FILES.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoScanEnabled}
              disabled={savingScan}
              onClick={() => void toggleAutoScan(!settings.autoScanEnabled)}
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
          <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-500">Status</dt>
              <dd>
                {settings.autoScanEnabled || settings.envForceEnabled
                  ? "Aktif"
                  : "Nonaktif"}
                {settings.envForceEnabled && (
                  <span className="ml-1 text-amber-700">
                    (dipaksa oleh AUTO_SCAN_ENABLED di env)
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
