/** Explicit Ask mode from UI chips (overrides heuristic intent when not auto). */
export type AskMode = "auto" | "list" | "detail" | "analyze" | "compare";

export type AskIntent = "list" | "detail" | "compare" | "analyze" | "default";

export function parseAskMode(raw: unknown): AskMode {
  const s = String(raw ?? "auto")
    .trim()
    .toLowerCase();
  if (s === "list" || s === "detail" || s === "analyze" || s === "compare") {
    return s;
  }
  return "auto";
}

/** Map UI mode to intent; null means fall back to planner/heuristic. */
export function intentFromAskMode(mode: AskMode): AskIntent | null {
  if (mode === "auto") return null;
  if (mode === "analyze") return "analyze";
  return mode;
}

/**
 * Soften analyze: without focus docs, prefer detail retrieval over full-OCR analyze.
 */
export function softenAnalyzeWithoutFocus(
  intent: AskIntent,
  hasFocus: boolean
): AskIntent {
  if (intent === "analyze" && !hasFocus) return "detail";
  return intent;
}

export const ASK_MODE_LABELS: Record<AskMode, string> = {
  auto: "Otomatis",
  list: "Cari dokumen",
  detail: "Tanya isi",
  analyze: "Analisis",
  compare: "Bandingkan",
};

/** Fact-style questions that should force tool extraction even if retrieval score is high. */
export function looksLikeFactQuestion(question: string): boolean {
  return /\b(berapa|jumlah|total|nomor|no\.?\s|tanggal|agenda|keputusan|kesimpulan|siapa|hadir|peserta|anggaran|rp\.?|biaya|nilai|kapan|dimana|di mana)\b/i.test(
    question
  );
}

/**
 * User clearly wants a fresh archive search (do not reuse sticky focus from prior turn).
 */
export function wantsFreshArchiveSearch(
  question: string,
  askMode: AskMode = "auto"
): boolean {
  if (askMode === "list") return true;
  return /\b(cari|temukan|lihat dokumen|apa saja dokumen|dokumen tentang|dokumen lain|arsip lain|seluruh arsip|semua arsip|yang lain|beda dokumen|ganti dokumen|dokumen terkait)\b/i.test(
    question
  );
}

/** Soft expand beyond pin/sticky primary docs. */
export function wantsFocusExpand(
  question: string,
  askMode: AskMode = "auto"
): boolean {
  if (askMode === "list" || askMode === "compare") return true;
  return /\b(terkait|dokumen lain|cari|bandingkan|selain|juga|plus|tambahan|yang sama|mirip)\b/i.test(
    question
  );
}

const STOP = new Set([
  "yang",
  "dan",
  "atau",
  "dari",
  "untuk",
  "dengan",
  "pada",
  "dalam",
  "ini",
  "itu",
  "apa",
  "ada",
  "sudah",
  "belum",
  "berapa",
  "siapa",
  "kapan",
  "bagaimana",
  "jelaskan",
  "uraikan",
  "ringkas",
  "dokumen",
  "tentang",
  "mohon",
  "tolong",
  "the",
  "and",
  "of",
  "to",
  "in",
  "a",
  "is",
]);

export function topicTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/**
 * Sticky follow-up stays only if the new question still overlaps prior source titles
 * or is a short pronoun-style follow-up ("berapa anggarannya?", "siapa yang hadir?").
 */
export function stickyFocusStillRelevant(
  question: string,
  priorLabels: string[]
): boolean {
  if (priorLabels.length === 0) return false;
  const q = question.trim();
  if (!q) return false;

  // Short follow-ups with anaphora / fact words → keep sticky
  const words = q.split(/\s+/).filter(Boolean);
  if (
    words.length <= 10 &&
    /\b(nya|tersebut|itu|ini|di atas|dari dokumen|anggarannya|pesertanya|keputusannya|agendanya|nomornya|tanggalnya|lanjutkan|lebih detail|lebih lengkap|jelaskan lagi|uraikan|sebutkan)\b/i.test(
      q
    )
  ) {
    return true;
  }
  if (words.length <= 8 && looksLikeFactQuestion(q)) {
    return true;
  }

  const qTokens = new Set(topicTokens(q));
  // Stopword-only / no topical tokens: do not blindly keep sticky
  // (avoids clinging to old docs on vague follow-ups)
  if (qTokens.size === 0) return false;

  const labelTokens = new Set(topicTokens(priorLabels.join(" ")));
  if (labelTokens.size === 0) return true;

  let hits = 0;
  for (const t of qTokens) {
    if (labelTokens.has(t)) hits += 1;
  }
  // Need some topical overlap; otherwise treat as new search (user forgot pin but changed topic)
  const ratio = hits / qTokens.size;
  return hits >= 1 && ratio >= 0.2;
}

/** OCR text too thin for reliable grounded answers (scanned/image-heavy). */
export function isThinOcrChars(charCount: number): boolean {
  const n = Number(process.env.ASK_THIN_OCR_CHARS ?? "400");
  const threshold = Number.isFinite(n) ? Math.min(5000, Math.max(50, n)) : 400;
  return charCount < threshold;
}
