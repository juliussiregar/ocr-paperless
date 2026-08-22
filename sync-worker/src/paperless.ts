import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const PAPERLESS_URL = process.env.PAPERLESS_URL ?? "http://paperless:8000";
const PAPERLESS_TOKEN = process.env.PAPERLESS_TOKEN ?? "";
const CONSUME_DIR = process.env.CONSUME_DIR ?? "/consume";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (PAPERLESS_TOKEN) {
    headers.Authorization = `Token ${PAPERLESS_TOKEN}`;
  }
  return headers;
}

export async function submitToPaperlessConsume(
  buffer: Buffer,
  originalName: string
): Promise<string> {
  await mkdir(CONSUME_DIR, { recursive: true });
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}_${safeName}`;
  await writeFile(join(CONSUME_DIR, fileName), buffer);
  return fileName;
}

/**
 * Exact checksum match only — never fall back to first result.
 * Paperless filters by checksum__iexact; some API versions omit the
 * checksum field from the serializer, so a unique filter hit is trusted.
 */
export async function findPaperlessDocumentByChecksum(
  checksum: string
): Promise<number | null> {
  if (!PAPERLESS_TOKEN) return null;

  try {
    const params = new URLSearchParams({
      checksum__iexact: checksum,
      page_size: "5",
      fields: "id,checksum",
    });

    const res = await fetch(`${PAPERLESS_URL}/api/documents/?${params}`, {
      headers: authHeaders(),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      count?: number;
      results?: Array<{ id: number; checksum?: string }>;
    };

    const results = data.results ?? [];
    if (results.length === 0) return null;

    const match = results.find(
      (d) => d.checksum?.toLowerCase() === checksum.toLowerCase()
    );
    if (match) return match.id;

    // Serializer omitted checksum — unique iexact hit is still exact
    if ((data.count ?? results.length) === 1) return results[0].id;

    return null;
  } catch {
    return null;
  }
}

export async function getPaperlessHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${PAPERLESS_URL}/api/`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok || res.status === 401 || res.status === 403;
  } catch {
    return false;
  }
}
