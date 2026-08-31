/** Parse WebDAV lastmod / HTTP date; null if missing or invalid. */
export function parseWebDavDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : null;
}

export function parseWebDavDateIso(raw: unknown): string | null {
  const d = parseWebDavDate(raw);
  return d ? d.toISOString() : null;
}
