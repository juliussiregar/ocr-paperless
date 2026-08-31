import { connection } from "./scan-queues.js";

const LOCK_TTL_SEC = 3600;

export async function tryAcquireUserScanLock(userId: string): Promise<boolean> {
  const key = `scan:lock:${userId}`;
  const res = await connection.set(key, "1", "EX", LOCK_TTL_SEC, "NX");
  return res === "OK";
}

export async function releaseUserScanLock(userId: string): Promise<void> {
  await connection.del(`scan:lock:${userId}`);
}

export async function withUserScanLock<T>(
  userId: string,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; reason: "busy" }> {
  const acquired = await tryAcquireUserScanLock(userId);
  if (!acquired) return { ok: false, reason: "busy" };
  try {
    const value = await fn();
    return { ok: true, value };
  } finally {
    await releaseUserScanLock(userId);
  }
}
