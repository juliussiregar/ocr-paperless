/** Shared empty-file warning labels (app + worker). */
export const EMPTY_FILE_WARNING =
  "Peringatan: file kosong (0 byte). Tidak bisa di-OCR. Perbaiki atau ganti file di Cloud Bappenas.";

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

/** FAILED rows that are legacy empty-file errors (before warning migration). */
export function isLegacyEmptyFileFailed(
  message: string | null | undefined
): boolean {
  return isEmptyFileWarningMessage(message);
}

export function isRetryableFailed(
  status: string,
  errorMessage: string | null | undefined
): boolean {
  if (status !== "FAILED") return false;
  return !isEmptyFileWarningMessage(errorMessage);
}

/** OR conditions for empty-file FAILED/SKIPPED rows. */
export function legacyEmptyFileOrConditions() {
  return [
    { fileSize: BigInt(0) },
    {
      errorMessage: { contains: "file kosong", mode: "insensitive" as const },
    },
    { errorMessage: { contains: "0 byte", mode: "insensitive" as const } },
  ];
}

/** Prisma filter: FAILED rows that are empty-file stubs (legacy or size 0). */
export function legacyEmptyFailedWhere() {
  return {
    syncStatus: "FAILED" as const,
    OR: legacyEmptyFileOrConditions(),
  };
}

/** Prisma filter: SKIPPED rows marked as empty-file warning. */
export function emptyFileWarningWhere() {
  return {
    syncStatus: "SKIPPED" as const,
    OR: legacyEmptyFileOrConditions(),
  };
}
