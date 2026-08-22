/** Clean machine-ish Paperless / sync filenames for UI. */
export function humanizeFileName(raw: string | null | undefined): string {
  if (!raw?.trim()) return "Dokumen";
  let s = raw.trim().replace(/\.pdf$/i, "");
  // Leading timestamp / numeric id: 1787425529309_...
  s = s.replace(/^\d{8,}[_-]*/g, "");
  // Repeated separators from sync naming
  s = s.replace(/_+/g, " ");
  s = s.replace(/\s*-\s*/g, " - ");
  s = s.replace(/\s+/g, " ").trim();
  return s || raw.replace(/\.pdf$/i, "").trim() || "Dokumen";
}

export function citationLabel(c: {
  title?: string | null;
  fileName?: string | null;
}): string {
  const title = c.title?.trim() ?? "";
  const file = c.fileName?.trim() ?? "";
  // Prefer title unless it looks like the same machine name
  const pick =
    title && !/^\d{8,}/.test(title) && title.length >= 3 ? title : file || title;
  return humanizeFileName(pick);
}
