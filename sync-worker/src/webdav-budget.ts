/**
 * Shared cap for Bappenas WebDAV (PROPFIND + download).
 * Prevents discovery∥ingest from opening discovery+download slots at once.
 */
const waiters: Array<() => void> = [];
let active = 0;

export function webdavTotalConcurrency(): number {
  const n = Number(process.env.WEBDAV_TOTAL_CONCURRENCY ?? "28");
  if (!Number.isFinite(n) || n < 4) return 28;
  return Math.min(48, Math.floor(n));
}

async function acquire(): Promise<void> {
  const max = webdavTotalConcurrency();
  if (active < max) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

export async function withWebDavSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
