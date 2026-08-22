import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { SyncStatus } from "@prisma/client";
import { abandonInFlightSyncFiles } from "@/lib/scan-cleanup";

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.round(seconds);
  if (s < 60) return `~${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `~${m}m ${rem}s` : `~${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `~${h}h ${rm}m` : `~${h}h`;
}

function computeEtaSec(job: {
  startedAt: Date | null;
  processedFiles: number;
  totalFiles: number;
  status: string;
}): number | null {
  if (job.status !== "RUNNING" && job.status !== "PAUSED") return null;
  if (!job.startedAt || job.totalFiles <= 0 || job.processedFiles <= 0) {
    return null;
  }
  const remaining = job.totalFiles - job.processedFiles;
  if (remaining <= 0) return 0;
  const elapsedSec = (Date.now() - job.startedAt.getTime()) / 1000;
  if (elapsedSec < 3) return null;
  const rate = job.processedFiles / elapsedSec;
  if (rate <= 0) return null;
  return remaining / rate;
}

function jobPhaseLabel(job: {
  status: string;
  phase: string | null;
  totalFiles: number;
  processedFiles: number;
  currentFile: string | null;
  startedAt: Date | null;
}): { phase: string; title: string; detail: string; etaSeconds: number | null } {
  const status = job.status;
  const phase = job.phase;
  const etaSeconds = computeEtaSec(job);
  const etaSuffix = etaSeconds != null ? ` · sisa ${formatEta(etaSeconds)}` : "";

  if (status === "PENDING") {
    return {
      phase: "pending",
      title: "Menunggu antrian…",
      detail: "Job sudah dibuat, menunggu worker memulai.",
      etaSeconds: null,
    };
  }

  if (status === "PAUSED") {
    return {
      phase: "paused",
      title: "Dijeda",
      detail:
        `Proses dihentikan sementara di ${job.processedFiles}/${job.totalFiles || "?"}. Klik Resume untuk lanjut.` +
        (job.currentFile ? ` File terakhir: ${job.currentFile}` : ""),
      etaSeconds,
    };
  }

  if (status === "RUNNING") {
    if (phase === "starting") {
      return {
        phase: "starting",
        title: "Menyiapkan…",
        detail: "Memeriksa kredensial dan memulai job.",
        etaSeconds: null,
      };
    }
    if (
      phase === "discovering" ||
      (job.totalFiles === 0 &&
        phase !== "downloading" &&
        phase !== "submitting" &&
        phase !== "starting")
    ) {
      return {
        phase: "discovering",
        title: "Mencari PDF di cloud…",
        detail:
          job.processedFiles > 0
            ? `${job.processedFiles} PDF baru ditemukan (belum mulai unduh).`
            : "Sedang menelusuri folder (paralel). Fetch newest biasanya berhenti lebih awal.",
        etaSeconds: null,
      };
    }
    if (phase === "submitting") {
      return {
        phase: "submitting",
        title: "Mengirim ke OCR…",
        detail:
          (job.currentFile
            ? `File: ${job.currentFile}`
            : "Mengirim PDF ke Paperless untuk OCR.") + etaSuffix,
        etaSeconds,
      };
    }
    return {
      phase: "downloading",
      title: "Mengunduh & mengirim file…",
      detail:
        (job.currentFile
          ? `Sedang: ${job.currentFile} · ${job.processedFiles}/${job.totalFiles || "?"} selesai dikirim`
          : `${job.processedFiles}/${job.totalFiles || "?"} file selesai dikirim ke OCR`) +
        etaSuffix,
      etaSeconds,
    };
  }

  if (status === "COMPLETED") {
    return {
      phase: "done",
      title: "Pengiriman selesai",
      detail:
        "File sudah dikirim. OCR Paperless mungkin masih berjalan di beberapa file.",
      etaSeconds: null,
    };
  }
  if (status === "CANCELLED") {
    return {
      phase: "done",
      title: "Dibatalkan",
      detail:
        "Proses dihentikan. File yang belum terkirim ke OCR dibersihkan dari antrean.",
      etaSeconds: null,
    };
  }
  if (status === "FAILED") {
    return {
      phase: "done",
      title: "Gagal",
      detail: "Terjadi error saat ingest.",
      etaSeconds: null,
    };
  }

  return {
    phase: phase ?? "unknown",
    title: status,
    detail: "",
    etaSeconds: null,
  };
}

function statusActive(status: string) {
  return (
    status === "PENDING" || status === "RUNNING" || status === "PAUSED"
  );
}

async function authorizeJob(
  sessionUserId: string,
  role: string | undefined,
  jobId: string
) {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: NextResponse.json({ error: "Job not found" }, { status: 404 }) };
  if (job.triggeredById !== sessionUserId && role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { job };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const authz = await authorizeJob(session.user.id, session.user.role, id);
  if (authz.error) return authz.error;
  const job = authz.job!;

  const ocrPendingCount = job.triggeredById
    ? await prisma.syncFile.count({
        where: {
          userId: job.triggeredById,
          syncStatus: SyncStatus.OCR_PENDING,
        },
      })
    : 0;

  const labels = jobPhaseLabel(job);
  const total = job.totalFiles;
  const processed = job.processedFiles;
  const percent =
    labels.phase === "discovering" || labels.phase === "paused"
      ? labels.phase === "paused" && total > 0
        ? Math.min(100, Math.round((processed / total) * 100))
        : labels.phase === "paused"
          ? null
          : null
      : total > 0
        ? Math.min(100, Math.round((processed / total) * 100))
        : statusActive(job.status)
          ? 0
          : 100;

  return NextResponse.json({
    ...job,
    phase: labels.phase,
    phaseTitle: labels.title,
    phaseDetail: labels.detail,
    progressPercent: percent,
    etaSeconds: labels.etaSeconds,
    ocrPendingCount,
  });
}

/** Pause / resume a running scan: { action: "pause" | "resume" } */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const authz = await authorizeJob(session.user.id, session.user.role, id);
  if (authz.error) return authz.error;
  const job = authz.job!;

  const body = await request.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "pause") {
    if (job.status !== "RUNNING") {
      return NextResponse.json(
        { error: "Hanya job RUNNING yang bisa dijeda", status: job.status },
        { status: 400 }
      );
    }
    const updated = await prisma.scanJob.update({
      where: { id },
      data: { status: "PAUSED", phase: "paused" },
    });
    await writeAudit("scan.pause", session.user.id, { jobId: id });
    return NextResponse.json({
      ...updated,
      message: "Dijeda. File yang sedang diunduh selesai dulu, lalu berhenti.",
    });
  }

  if (action === "resume") {
    if (job.status !== "PAUSED") {
      return NextResponse.json(
        { error: "Hanya job PAUSED yang bisa dilanjutkan", status: job.status },
        { status: 400 }
      );
    }
    const resumePhase =
      job.totalFiles === 0 ? "discovering" : "downloading";
    const updated = await prisma.scanJob.update({
      where: { id },
      data: { status: "RUNNING", phase: resumePhase },
    });
    await writeAudit("scan.resume", session.user.id, { jobId: id });
    return NextResponse.json({ ...updated, message: "Dilanjutkan." });
  }

  return NextResponse.json({ error: "action harus pause atau resume" }, { status: 400 });
}

/** Cancel a pending/running/paused scan */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const authz = await authorizeJob(session.user.id, session.user.role, id);
  if (authz.error) return authz.error;
  const job = authz.job!;

  if (
    job.status !== "PENDING" &&
    job.status !== "RUNNING" &&
    job.status !== "PAUSED"
  ) {
    return NextResponse.json(
      { error: "Job is not cancellable", status: job.status },
      { status: 400 }
    );
  }

  const updated = await prisma.scanJob.update({
    where: { id },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      errorMessage: "Cancelled by user",
      phase: "done",
      currentFile: null,
    },
  });

  let abandoned = 0;
  if (job.triggeredById) {
    abandoned = await abandonInFlightSyncFiles(
      job.triggeredById,
      "Dibatalkan sebelum dikirim ke OCR"
    );
  }

  await writeAudit("scan.cancel", session.user.id, {
    jobId: id,
    abandoned,
  });

  return NextResponse.json({
    ...updated,
    abandoned,
    message:
      abandoned > 0
        ? `Dibatalkan. ${abandoned} file antre dibersihkan (bisa di-retry dari Failed).`
        : "Dibatalkan.",
  });
}
