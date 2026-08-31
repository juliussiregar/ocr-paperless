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

/** Users with decryptable Bappenas credentials (excludes placeholders). */
export async function listUsersWithBappenasCreds(): Promise<
  Array<{ id: string; email: string }>
> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { email: "asc" },
  });

  const withCreds: Array<{ id: string; email: string }> = [];
  for (const u of users) {
    const creds = await getUserBappenasCreds(u.id);
    if (creds) withCreds.push({ id: u.id, email: u.email });
  }
  return withCreds;
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
  | "DELETED"
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
    case "DELETED":
      return "Dihapus dari cloud";
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
  if (syncStatus === "DELETED") return "not_ingested";
  return "not_ingested";
}

/** Map raw SyncFile.errorMessage to short title + suggestion (ID). */
export function humanizeSyncError(raw: string | null | undefined): {
  title: string;
  hint: string;
} {
  const msg = (raw ?? "").trim();
  if (!msg) {
    return {
      title: "Gagal diproses",
      hint: "Coba OCR lagi dari antrean gagal.",
    };
  }
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("ocr timeout")) {
    return {
      title: "OCR timeout",
      hint: "Paperless belum selesai dalam batas waktu. Tekan Coba OCR lagi.",
    };
  }
  if (
    lower.includes("kosong") ||
    lower.includes("0 byte") ||
    lower.includes("0b")
  ) {
    return {
      title: "File kosong (0 B)",
      hint: "File di Cloud tidak berisi data. Ganti/unggah ulang di Bappenas, lalu scan lagi.",
    };
  }
  if (lower.includes("macet") || lower.includes("stuck")) {
    return {
      title: "Proses macet",
      hint: "File antre terlalu lama tanpa scan aktif. Aman untuk Coba OCR lagi.",
    };
  }
  if (
    lower.includes("dibatalkan") ||
    lower.includes("cancelled") ||
    lower.includes("cancel")
  ) {
    return {
      title: "Dibatalkan",
      hint: "Belum sempat OCR. Tekan Coba OCR lagi bila masih dibutuhkan.",
    };
  }
  if (
    lower.includes("econn") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return {
      title: "Gagal unduh / koneksi",
      hint: "Cek koneksi WebDAV Bappenas, lalu Coba OCR lagi.",
    };
  }
  return {
    title: msg.length > 80 ? `${msg.slice(0, 77)}…` : msg,
    hint: "Coba OCR lagi. Jika berulang, cek kredensial Cloud.",
  };
}

/** Relative age label for pending/failed rows. */
export function formatSyncAge(
  iso: string | Date | null | undefined
): string | null {
  if (!iso) return null;
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} mnt`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} jam`;
  return `${Math.floor(hrs / 24)} hari`;
}
