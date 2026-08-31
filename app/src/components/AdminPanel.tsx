"use client";

import Link from "next/link";
import { Radio } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { AdminAuditPanel } from "@/components/AdminAuditPanel";

export function AdminPanel() {
  return (
    <div className="space-y-6">
      <AdminAuditPanel />

      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <Radio size={18} />
            </div>
            <div>
              <h2 className="section-title">Sync cloud</h2>
              <p className="text-xs text-slate-500">
                Pipeline live, job aktif, tahapan discover sampai embed, dan
                riwayat tanpa refresh.
              </p>
            </div>
          </div>
          <Link
            href="/admin/sync"
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Buka Sync log
          </Link>
        </div>
      </Card>
    </div>
  );
}
