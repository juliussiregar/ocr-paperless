import { SyncStatus } from "@prisma/client";

/** User-facing warning (stored on SKIPPED, not FAILED). */
export const EMPTY_FILE_WARNING =
  "Peringatan: file kosong (0 byte). Tidak bisa di-OCR. Perbaiki atau ganti file di Cloud Bappenas.";

export const EMPTY_CONTENT_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function isEmptyFileWarningMessage(
  message: string | null | undefined
): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("peringatan: file kosong") ||
    m.includes("file kosong (0 byte)") ||
    (m.includes("kosong") && m.includes("0 byte"))
  );
}

export function isEmptyDownload(size: number, hash: string): boolean {
  return size === 0 || hash === EMPTY_CONTENT_HASH;
}

export function isEmptyRemoteSize(size: bigint | number | null | undefined): boolean {
  if (size == null) return false;
  return Number(size) === 0;
}

export function legacyEmptyFileOrConditions() {
  return [
    { fileSize: BigInt(0) },
    {
      errorMessage: { contains: "file kosong", mode: "insensitive" as const },
    },
    { errorMessage: { contains: "0 byte", mode: "insensitive" as const } },
  ];
}

export type EmptyFileMarkData = {
  contentHash?: string;
  fileSize?: bigint;
  etag?: string | null;
  lastModified?: Date | null;
  mimeType?: string | null;
  fileName?: string;
};

/** Mark sync file as SKIPPED warning (not FAILED, no retry loop). */
export function emptyFileSkippedPatch(
  extra: EmptyFileMarkData = {}
): {
  syncStatus: typeof SyncStatus.SKIPPED;
  errorMessage: string;
  ocrPendingAt: null;
  ingestRetryCount?: number;
} {
  return {
    syncStatus: SyncStatus.SKIPPED,
    errorMessage: EMPTY_FILE_WARNING,
    ocrPendingAt: null,
    ...extra,
  };
}
