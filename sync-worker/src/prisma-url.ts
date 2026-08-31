/**
 * Cap Prisma pool so DocSearch (app + worker) + Paperless fit under Postgres max_connections.
 * Appends connection_limit / pool_timeout when missing from DATABASE_URL.
 */
export function prismaDatabaseUrl(
  rawUrl: string | undefined,
  defaultLimit: number
): string | undefined {
  if (!rawUrl) return rawUrl;
  if (/[?&]connection_limit=/i.test(rawUrl)) return rawUrl;

  const limitEnv = Number(process.env.PRISMA_CONNECTION_LIMIT ?? "");
  const limit =
    Number.isFinite(limitEnv) && limitEnv > 0
      ? Math.floor(limitEnv)
      : defaultLimit;

  const timeoutEnv = Number(process.env.PRISMA_POOL_TIMEOUT ?? "");
  const poolTimeout =
    Number.isFinite(timeoutEnv) && timeoutEnv > 0
      ? Math.floor(timeoutEnv)
      : 30;

  const sep = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${sep}connection_limit=${limit}&pool_timeout=${poolTimeout}`;
}
