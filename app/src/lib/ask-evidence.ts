import { humanizeFileName } from "./display-name";

export type AskEvidence = {
  /** Stable marker shown in context and answers, e.g. S1 */
  id: string;
  docId: number;
  title: string;
  fileName: string;
  page: number | null;
  quote: string;
};

export type ChatCitationLike = {
  id: number;
  title: string;
  fileName: string;
  page?: number | null;
  quote?: string;
  evidenceId?: string;
};

const MAX_EVIDENCE = 24;
const MAX_QUOTE_CHARS = 420;

function cleanQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
}

export function makeEvidenceId(index: number): string {
  return `S${index}`;
}

export function buildEvidenceFromChunks(
  items: Array<{
    docId: number;
    title: string;
    fileName: string;
    page: number | null;
    content: string;
  }>,
  /** 1-based start for marker ids (default 1). Use when appending to existing evidence. */
  startAt = 1
): AskEvidence[] {
  const out: AskEvidence[] = [];
  let next = Math.max(1, Math.floor(startAt));
  for (const item of items) {
    if (out.length >= MAX_EVIDENCE) break;
    const quote = cleanQuote(item.content);
    if (quote.length < 12) continue;
    out.push({
      id: makeEvidenceId(next),
      docId: item.docId,
      title: item.title,
      fileName: item.fileName,
      page: item.page != null && item.page > 0 ? item.page : null,
      quote,
    });
    next += 1;
  }
  return out;
}

/**
 * Append extra evidence with globally unique [Sn] ids continuing from `base`.
 * Extra ids from the caller are ignored (renumbered) to avoid collisions.
 */
export function mergeEvidence(
  base: AskEvidence[],
  extra: AskEvidence[]
): AskEvidence[] {
  const out = [...base];
  const seen = new Set(
    base.map((e) => `${e.docId}:${e.quote.slice(0, 80).toLowerCase()}`)
  );
  for (const e of extra) {
    if (out.length >= MAX_EVIDENCE) break;
    const key = `${e.docId}:${e.quote.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...e,
      id: makeEvidenceId(out.length + 1),
    });
  }
  return out;
}

/** Format evidence block for the model context (markers [S1], [S2], …). */
export function formatEvidenceForContext(evidence: AskEvidence[]): string {
  if (evidence.length === 0) return "";
  return evidence
    .map((e) => {
      const page =
        e.page != null && e.page > 0 ? ` halaman ${e.page}` : "";
      return `[${e.id}] Dokumen ID ${e.docId} · ${e.title}${page}\n"${e.quote}"`;
    })
    .join("\n\n");
}

/** Only the newly appended markers (after `fromIndex`). */
export function formatEvidenceDelta(
  evidence: AskEvidence[],
  fromIndex: number
): string {
  return formatEvidenceForContext(evidence.slice(Math.max(0, fromIndex)));
}

export function evidenceToCitations(evidence: AskEvidence[]): ChatCitationLike[] {
  const byDoc = new Map<number, ChatCitationLike>();
  for (const e of evidence) {
    const prev = byDoc.get(e.docId);
    if (!prev) {
      byDoc.set(e.docId, {
        id: e.docId,
        title: e.title,
        fileName: e.fileName,
        page: e.page,
        quote: e.quote,
        evidenceId: e.id,
      });
      continue;
    }
    // Prefer citation with a page when merging same doc
    if ((prev.page == null || prev.page <= 0) && e.page != null && e.page > 0) {
      prev.page = e.page;
      prev.quote = e.quote;
      prev.evidenceId = e.id;
    }
  }
  return [...byDoc.values()];
}

/** Extract [S1], [S2] markers referenced in the answer. */
export function parseEvidenceMarkers(answer: string): string[] {
  const found = new Set<string>();
  const re = /\[(S\d+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    found.add(m[1]!.toUpperCase());
  }
  return [...found];
}

/**
 * Prefer citations whose evidence markers appear in the answer.
 * Falls back to filename/token matching when no markers are present.
 */
export function filterCitationsByEvidence(
  answer: string,
  evidence: AskEvidence[],
  fallbackCitations: ChatCitationLike[]
): ChatCitationLike[] {
  const markers = parseEvidenceMarkers(answer);
  if (markers.length > 0 && evidence.length > 0) {
    const byId = new Map(evidence.map((e) => [e.id.toUpperCase(), e]));
    const used: ChatCitationLike[] = [];
    const seenDoc = new Set<number>();
    for (const mid of markers) {
      const e = byId.get(mid);
      if (!e || seenDoc.has(e.docId)) continue;
      seenDoc.add(e.docId);
      used.push({
        id: e.docId,
        title: e.title,
        fileName: e.fileName,
        page: e.page,
        quote: e.quote,
        evidenceId: e.id,
      });
    }
    if (used.length > 0) return used;
  }

  return filterCitationsByName(answer, fallbackCitations);
}

/** Legacy filename/title match (kept as fallback). */
export function filterCitationsByName(
  answer: string,
  citations: ChatCitationLike[]
): ChatCitationLike[] {
  if (citations.length === 0) return [];
  const text = answer.toLowerCase();

  const used = citations.filter((c) => {
    const label = humanizeFileName(
      (c.title && !/^\d{8,}/.test(c.title) ? c.title : c.fileName) ||
        c.title ||
        ""
    ).toLowerCase();
    const title = (c.title || "").toLowerCase().trim();
    const file = (c.fileName || "").toLowerCase().trim();
    const base = file.replace(/\.pdf$/i, "");

    if (label.length >= 10) {
      const tip = label.slice(0, Math.min(36, label.length));
      if (text.includes(tip)) return true;
    }
    if (title.length >= 10) {
      const tip = title.replace(/^\d{8,}[_-]*/, "").slice(0, 36);
      if (tip.length >= 10 && text.includes(tip.toLowerCase())) return true;
    }
    if (file.length >= 12 && text.includes(file)) return true;
    if (base.length >= 12 && text.includes(base)) return true;

    const tokens = `${label} ${title} ${base}`
      .split(/[^a-z0-9à-ü]+/i)
      .map((t) => t.trim().toLowerCase())
      .filter(
        (t) =>
          t.length >= 7 &&
          !/^(dokumen|undangan|laporan|rencana|sumatera|progres|rapat|finalisasi|rekonstruksi|rehabilitasi)$/i.test(
            t
          )
      );
    const hits = tokens.filter((t) => text.includes(t)).length;
    return hits >= 2;
  });

  if (used.length > 0) return used;

  return citations.filter((c) => {
    const label = humanizeFileName(
      (c.title && !/^\d{8,}/.test(c.title) ? c.title : c.fileName) || ""
    ).toLowerCase();
    if (label.length < 14) return false;
    const tip = label.slice(0, 28);
    return text.includes(tip);
  });
}
