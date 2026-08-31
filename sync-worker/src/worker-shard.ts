/** Multi-instance sync-worker: assign users by hash(userId) % SHARD_COUNT === SHARD_INDEX */
export function userInWorkerShard(userId: string): boolean {
  const count = Number(process.env.SYNC_WORKER_SHARD_COUNT ?? "1");
  const index = Number(process.env.SYNC_WORKER_SHARD_INDEX ?? "0");
  if (!Number.isFinite(count) || count <= 1) return true;
  const idx = Number.isFinite(index) ? Math.floor(index) : 0;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash + userId.charCodeAt(i)) % count;
  }
  return hash === idx;
}
