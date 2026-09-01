import { prisma } from "@/lib/prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** Wait while Postgres is saturated (Paperless OCR + sync peaks). */
export async function waitWhileDbHot(opts?: {
  maxWaitMs?: number;
  pollMs?: number;
  label?: string;
}): Promise<{ waitedMs: number; lastClients: number | null }> {
  const maxWaitMs =
    opts?.maxWaitMs ?? Number(process.env.DB_HOT_MAX_WAIT_MS ?? "120000");
  const pollMs = opts?.pollMs ?? 15_000;
  const label = opts?.label ?? "ask-db-hot";
  const threshold = dbHotClientsThreshold();
  const start = Date.now();
  let lastClients: number | null = null;

  while (Date.now() - start < maxWaitMs) {
    lastClients = await getDbClientCount();
    if (lastClients == null || lastClients < threshold) {
      return { waitedMs: Date.now() - start, lastClients };
    }
    await sleep(pollMs);
  }

  lastClients = await getDbClientCount();
  return { waitedMs: Date.now() - start, lastClients };
}
