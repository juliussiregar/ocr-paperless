import { prisma } from "./db.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Client count that counts as "DB panas" (default suited for max_connections=200). */
export function dbHotClientsThreshold(): number {
  const n = Number(process.env.DB_HOT_CLIENTS_THRESHOLD ?? "120");
  if (!Number.isFinite(n) || n < 20) return 120;
  return Math.floor(n);
}

export async function getDbClientCount(): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity
    `;
    const n = rows[0]?.n;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function isDbHot(): Promise<boolean> {
  const n = await getDbClientCount();
  if (n == null) return false;
  return n >= dbHotClientsThreshold();
}

/**
 * Wait while Postgres client count is high (Paperless OCR + sync peak).
 * Returns after cool-down or maxWaitMs.
 */
export async function waitWhileDbHot(opts?: {
  maxWaitMs?: number;
  pollMs?: number;
  label?: string;
}): Promise<{ waitedMs: number; lastClients: number | null }> {
  const maxWaitMs = opts?.maxWaitMs ?? Number(process.env.DB_HOT_MAX_WAIT_MS ?? "120000");
  const pollMs = opts?.pollMs ?? 15_000;
  const label = opts?.label ?? "db-hot";
  const threshold = dbHotClientsThreshold();
  const start = Date.now();
  let lastClients: number | null = null;

  while (Date.now() - start < maxWaitMs) {
    lastClients = await getDbClientCount();
    if (lastClients == null || lastClients < threshold) {
      return { waitedMs: Date.now() - start, lastClients };
    }
    console.warn(
      `[${label}] DB panas clients=${lastClients} (ambang ${threshold}), tunggu ${Math.round(pollMs / 1000)}s`
    );
    await sleep(pollMs);
  }

  lastClients = await getDbClientCount();
  console.warn(
    `[${label}] lanjut setelah max wait; clients=${lastClients ?? "?"}`
  );
  return { waitedMs: Date.now() - start, lastClients };
}
