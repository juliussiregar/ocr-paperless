import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export async function getUserBappenasCreds(userId: string): Promise<{
  url: string;
  username: string;
  password: string;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      bappenasUrl: true,
      encryptedBappenasUsername: true,
      encryptedBappenasPassword: true,
    },
  });

  if (!user?.encryptedBappenasUsername || !user.encryptedBappenasPassword) {
    return null;
  }

  try {
    const username = decrypt(user.encryptedBappenasUsername);
    const password = decrypt(user.encryptedBappenasPassword);
    if (!username || username === "admin-placeholder") return null;
    return {
      url: user.bappenasUrl || "https://cloud.bappenas.go.id",
      username,
      password,
    };
  } catch {
    return null;
  }
}

export type UiIngestStatus =
  | "not_ingested"
  | "processing"
  | "done"
  | "failed";

export type SyncStage =
  | "DISCOVERED"
  | "DOWNLOADING"
  | "QUEUED"
  | "OCR_PENDING"
  | "OCR_DONE"
  | "SKIPPED"
  | "FAILED"
  | null;

/** Human-readable stage for a single file (ID). */
export function syncStageLabel(stage: string | null | undefined): string {
  switch (stage) {
    case "DOWNLOADING":
      return "Mengunduh dari cloud…";
    case "QUEUED":
      return "Antri dikirim ke OCR…";
    case "OCR_PENDING":
      return "OCR sedang diproses…";
    case "OCR_DONE":
      return "Siap di aplikasi";
    case "SKIPPED":
      return "Sudah ada (duplikat)";
    case "FAILED":
      return "Gagal";
    case "DISCOVERED":
      return "Belum diambil";
    default:
      return "Belum diambil";
  }
}

/** 0–100 progress fill for a file row. */
export function syncStageProgress(stage: string | null | undefined): number {
  switch (stage) {
    case "QUEUED":
      return 20;
    case "DOWNLOADING":
      return 45;
    case "OCR_PENDING":
      return 75;
    case "OCR_DONE":
    case "SKIPPED":
      return 100;
    case "FAILED":
      return 100;
    default:
      return 0;
  }
}

export function mapSyncStatusToUi(
  syncStatus: string | null | undefined
): UiIngestStatus {
  if (!syncStatus || syncStatus === "DISCOVERED") return "not_ingested";
  if (
    syncStatus === "DOWNLOADING" ||
    syncStatus === "QUEUED" ||
    syncStatus === "OCR_PENDING"
  ) {
    return "processing";
  }
  if (syncStatus === "OCR_DONE" || syncStatus === "SKIPPED") return "done";
  if (syncStatus === "FAILED") return "failed";
  return "not_ingested";
}
