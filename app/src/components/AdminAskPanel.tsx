"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { showToast } from "@/components/Toast";
import type { AskEvalReport, AskGoldenCase } from "@/lib/ask-eval-types";

type AskHealth = {
  ask: {
    users: number;
    ocrReady: number;
    withEmbeddings: number;
    ocrPending: number;
    failed: number;
    chunksTotal: number;
  };
  db: { clients: number | null; hotThreshold: number; hot: boolean };
};

export function AdminAskPanel() {
  const [health, setHealth] = useState<AskHealth | null>(null);
  const [cases, setCases] = useState<AskGoldenCase[]>([]);
  const [report, setReport] = useState<AskEvalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, e] = await Promise.all([
        fetch("/api/admin/ask").then((r) => r.json()),
        fetch("/api/admin/ask/eval").then((r) => r.json()),
      ]);
      setHealth(h as AskHealth);
      setCases((e as { cases: AskGoldenCase[] }).cases ?? []);
    } catch {
      showToast("Gagal memuat data Ask AI", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runEval() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/ask/eval", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Eval gagal");
      setReport(data as AskEvalReport);
      showToast(
        `Eval selesai: retrieval ${data.hitRatePct}% (${data.hits}/${data.hits + data.misses})${
          data.answerHitRatePct != null
            ? `, jawaban ${data.answerHitRatePct}%`
            : ""
        }`,
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Eval gagal", "error");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat Ask AI...
      </div>
    );
  }

  const embedPct =
    health && health.ask.ocrReady > 0
      ? Math.round((health.ask.withEmbeddings / health.ask.ocrReady) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="section-title">Ask AI</h2>
            <p className="text-xs text-slate-500">
              Readiness arsip, eval retrieval golden set, status DB.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {health && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="!p-4">
            <p className="text-xs text-slate-500">OCR siap</p>
            <p className="text-2xl font-semibold text-slate-900">
              {health.ask.ocrReady}
            </p>
            <p className="text-xs text-slate-500">
              pending {health.ask.ocrPending}, gagal {health.ask.failed}
            </p>
          </Card>
          <Card className="!p-4">
            <p className="text-xs text-slate-500">Embedding</p>
            <p className="text-2xl font-semibold text-slate-900">{embedPct}%</p>
            <p className="text-xs text-slate-500">
              {health.ask.withEmbeddings} dokumen, {health.ask.chunksTotal} chunk
            </p>
          </Card>
          <Card className="!p-4">
            <p className="text-xs text-slate-500">DB clients</p>
            <p className="text-2xl font-semibold text-slate-900">
              {health.db.clients ?? "-"}
            </p>
            <p className="text-xs text-slate-500">
              hot: {health.db.hot ? "ya" : "tidak"} (ambang {health.db.hotThreshold})
            </p>
          </Card>
          <Card className="!p-4">
            <p className="text-xs text-slate-500">Golden cases</p>
            <p className="text-2xl font-semibold text-slate-900">{cases.length}</p>
            <p className="text-xs text-slate-500">Isi expectedDocIds untuk hit rate</p>
          </Card>
        </div>
      )}

      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Golden set eval</h3>
            <p className="text-xs text-slate-500">
              Uji retrieval (keyword planner + search) tanpa jawaban GPT penuh.
            </p>
          </div>
          <button
            type="button"
            disabled={running || cases.length === 0}
            onClick={runEval}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Jalankan eval
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2">ID</th>
                <th className="px-5 py-2">Pertanyaan</th>
                <th className="px-5 py-2">Expected</th>
                <th className="px-5 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-2 font-mono text-xs">{c.id}</td>
                  <td className="px-5 py-2 max-w-xs truncate">{c.question}</td>
                  <td className="px-5 py-2 font-mono text-xs">
                    {c.expectedDocIds?.length
                      ? c.expectedDocIds.join(", ")
                      : "-"}
                  </td>
                  <td className="px-5 py-2 text-xs text-slate-500">{c.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {report && (
        <Card className="!p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm font-semibold text-slate-900">
              Hasil eval (retrieval {report.hitRatePct}%
              {report.answerHitRatePct != null
                ? `, jawaban ${report.answerHitRatePct}%`
                : ""}
              )
            </p>
            <span className="text-xs text-slate-500">{report.ranAt}</span>
          </div>
          <div className="space-y-2">
            {report.results.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-slate-100 px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{r.id}</span>
                  {r.hit === true && (
                    <CheckCircle2 size={14} className="text-emerald-600" />
                  )}
                  {r.hit === false && (
                    <XCircle size={14} className="text-red-500" />
                  )}
                  {r.hit === null && (
                    <HelpCircle size={14} className="text-slate-400" />
                  )}
                  {r.answerHit === true && (
                    <span className="text-[10px] font-medium text-emerald-600">
                      jawaban OK
                    </span>
                  )}
                  {r.answerHit === false && (
                    <span className="text-[10px] font-medium text-red-500">
                      jawaban miss
                    </span>
                  )}
                  <span className="text-slate-700">{r.question}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  retrieved top-{r.topK}: {r.retrievedIds.slice(0, r.topK).join(", ") ||
                    "-"}
                  {r.plannerKeywords?.length
                    ? ` | kw: ${r.plannerKeywords.join(", ")}`
                    : ""}
                  {r.plannerIntent ? ` | intent: ${r.plannerIntent}` : ""}
                  {r.error ? ` | error: ${r.error}` : ""}
                  {r.answerSnippet
                    ? ` | jawaban: ${r.answerSnippet.slice(0, 120)}…`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
