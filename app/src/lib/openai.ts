import OpenAI from "openai";
import { searchDocuments, type PaperlessDocument, type SearchDocumentsOptions } from "./paperless";
import {
  estimateTokens,
  isEmbeddingConfigured,
} from "./embeddings";
import { humanizeFileName } from "./display-name";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";
import { planDocumentSearch, type SearchPlan } from "./ask-search-planner";
import {
  formatRetrievedSnippets,
  bestChunkScoreForDocs,
} from "./ask-retrieval";
import { retrieveWithAgentLoop } from "./ask-agent";
import {
  mapReduceDocumentBody,
  shouldMapReduce,
} from "./ask-map-reduce";
import { verifyAnswerAgainstContext, shouldVerifyAnswer } from "./ask-verify";
import { cachedSearchDocuments } from "./ask-search-cache";
import { embedQuery } from "./embeddings";
import { rankDocsByDocEmbedding, loadDocSummaries } from "./ask-doc-rank";
import {
  computeAskConfidence,
  shouldSuggestPin,
  type AskConfidence,
} from "./ask-confidence";
import { maybeVisionContextForZrb } from "./ask-vision";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const MAX_CONTEXT_DOCS = 8;
const MAX_CANDIDATE_DOCS = 25;
const CONTENT_CHARS_PER_DOC = 2800;
/** Per-doc body when listing many search hits (richer than before) */
const CONTENT_CHARS_LIST = 1400;
const CONTENT_CHARS_DETAIL = 4500;
const MAX_CHUNKS_IN_CONTEXT = 12;
const MAX_CHUNKS_DETAIL = 20;
const MAX_CHUNK_CHARS = 1200;
const MAX_DOCS_DETAIL = 3;
const MAX_DOCS_ANALYZE = 2;

function envInt(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

/** Max chars of full OCR text per doc in analyze mode (not a summary). */
function fullDocMaxChars(): number {
  return envInt("ASK_FULL_DOC_MAX_CHARS", 100000, 200000);
}

function analysisOverlapScanChars(): number {
  return envInt("ASK_RANK_CONTENT_CHARS", 48000, 120000);
}

type AskIntent = "list" | "detail" | "compare" | "analyze" | "default";

function chatModelForIntent(intent: AskIntent): string {
  const analyzeModel = process.env.ASK_ANALYZE_MODEL?.trim();
  const detailModel = process.env.ASK_DETAIL_MODEL?.trim();
  if (intent === "analyze" && analyzeModel) return analyzeModel;
  if (
    (intent === "detail" || intent === "compare" || intent === "analyze") &&
    detailModel
  ) {
    return detailModel;
  }
  return model;
}

function resolveIntent(
  question: string,
  hasFocus: boolean,
  searchPlan?: SearchPlan,
  autoFocused?: boolean
): AskIntent {
  const pi = searchPlan?.intent;
  if (pi === "compare") return "compare";
  if (pi === "list") return "list";
  if (pi === "fact" || pi === "detail") return "detail";
  if (pi === "analyze" && (hasFocus || autoFocused)) return "analyze";
  return detectIntent(question, !!(hasFocus || autoFocused));
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

export function isOpenAiConfigured(): boolean {
  return !!getClient();
}

function displayDocName(doc: PaperlessDocument): string {
  const title = doc.title?.trim() ?? "";
  const file = doc.original_file_name?.trim() ?? "";
  const pick =
    title && !/^\d{8,}/.test(title) && title.length >= 3 ? title : file || title;
  return humanizeFileName(pick);
}

function buildFallbackContext(docs: PaperlessDocument[]): string {
  return docs
    .map(
      (doc, i) =>
        `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${doc.content?.slice(0, CONTENT_CHARS_PER_DOC) ?? "(kosong)"}`
    )
    .join("\n\n---\n\n");
}

/** Full OCR text (chunk-ordered) for deep analysis, not a summary. */
async function buildFullDocumentBody(
  doc: PaperlessDocument,
  userId: string | undefined,
  maxChars: number
): Promise<string> {
  const raw = (doc.content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";

  if (userId) {
    try {
      const { prisma } = await import("./prisma");
      const rows = await prisma.documentChunk.findMany({
        where: { userId, paperlessDocumentId: doc.id },
        orderBy: { chunkIndex: "asc" },
        select: { content: true },
      });
      if (rows.length > 0) {
        const joined = rows.map((r) => r.content).join("\n\n");
        if (joined.length >= raw.length * 0.85) {
          if (joined.length <= maxChars) return joined;
          return (
            joined.slice(0, maxChars) +
            "\n\n[Potong: teks OCR sangat panjang. Pin dokumen @ untuk fokus atau pecah pertanyaan per bagian.]"
          );
        }
      }
    } catch {
      // fall through to Paperless content
    }
  }

  if (raw.length <= maxChars) return raw;
  return (
    raw.slice(0, maxChars) +
    "\n\n[Potong: teks OCR sangat panjang. Pin dokumen @ untuk fokus atau pecah pertanyaan per bagian.]"
  );
}

async function buildAnalyzeContext(
  docs: PaperlessDocument[],
  userId: string | undefined,
  question: string
): Promise<{
  context: string;
  contextDocs: PaperlessDocument[];
  mapReduceUsage?: OpenAiUsageSnapshot;
}> {
  const maxChars = fullDocMaxChars();
  const take = docs.slice(0, MAX_DOCS_ANALYZE);
  const parts: string[] = [];
  let mapReduceUsage: OpenAiUsageSnapshot | undefined;

  for (let i = 0; i < take.length; i++) {
    const doc = take[i]!;
    const rawLen = (doc.content ?? "").replace(/\s+/g, " ").trim().length;
    let body: string;

    if (userId && shouldMapReduce(rawLen)) {
      const mapped = await mapReduceDocumentBody({
        doc,
        userId,
        question,
      });
      body = mapped.body;
      mapReduceUsage = mapReduceUsage
        ? mergeUsage(mapReduceUsage, mapped.usage)
        : mapped.usage;
    } else {
      body = await buildFullDocumentBody(doc, userId, maxChars);
    }

    parts.push(
      `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nTeks OCR (utuh/ringkas map-reduce):\n${body || "(kosong)"}`
    );
  }
  return {
    context: parts.join("\n\n---\n\n"),
    contextDocs: take,
    mapReduceUsage,
  };
}

/**
 * Hybrid: rank stored chunks by cosine vs question among candidate docs.
 * List/search questions prefer breadth (all candidates) over deep chunks.
 */
function minOcrChars(): number {
  const n = Number(process.env.ASK_MIN_OCR_CHARS ?? "100");
  if (!Number.isFinite(n)) return 100;
  return Math.min(5000, Math.max(0, Math.floor(n)));
}

function ocrContentLen(d: PaperlessDocument): number {
  return (d.content ?? "").replace(/\s+/g, " ").trim().length;
}

function passesOcrGate(
  d: PaperlessDocument,
  isList: boolean,
  nameScore: number
): boolean {
  if (isList) return true;
  if (nameScore >= 50) return true;
  return ocrContentLen(d) >= minOcrChars();
}

function autoFocusRatio(): number {
  const n = Number(process.env.ASK_AUTO_FOCUS_RATIO ?? "1.5");
  return Number.isFinite(n) ? Math.min(3, Math.max(1.1, n)) : 1.5;
}

function applyAutoFocus(
  ranked: PaperlessDocument[],
  scores: Map<number, number>,
  intent: AskIntent,
  hasFocus: boolean
): { docs: PaperlessDocument[]; autoFocused: boolean } {
  if (hasFocus || intent === "list" || intent === "compare") {
    return { docs: ranked, autoFocused: false };
  }
  const top = ranked[0];
  const second = ranked[1];
  if (!top) return { docs: ranked, autoFocused: false };
  const s1 = scores.get(top.id) ?? 0;
  const s2 = second ? (scores.get(second.id) ?? 0) : 0;
  const ratio = autoFocusRatio();
  if (s1 < 35) return { docs: ranked, autoFocused: false };
  if (s2 > 0 && s1 < s2 * ratio) return { docs: ranked, autoFocused: false };
  if (
    intent === "detail" ||
    intent === "analyze"
  ) {
    return { docs: [top], autoFocused: true };
  }
  return { docs: ranked, autoFocused: false };
}

async function buildContext(
  docs: PaperlessDocument[],
  question: string,
  userId?: string,
  intent: AskIntent = "default",
  keywords?: string[],
  allRankedDocs?: PaperlessDocument[],
  isAdmin?: boolean
): Promise<{
  context: string;
  contextDocs: PaperlessDocument[];
  embeddingHits: number;
  embeddingTokens: number;
  mapReduceUsage?: OpenAiUsageSnapshot;
  retrievalScore: number;
  rerankUsage?: OpenAiUsageSnapshot;
  hydeUsage?: OpenAiUsageSnapshot;
  visionUsage?: OpenAiUsageSnapshot;
}> {
  if (docs.length === 0) {
    return {
      context: "",
      contextDocs: [],
      embeddingHits: 0,
      embeddingTokens: 0,
      retrievalScore: 0,
    };
  }

  if (intent === "analyze") {
    const { context, contextDocs, mapReduceUsage } = await buildAnalyzeContext(
      docs,
      userId,
      question
    );
    return {
      context,
      contextDocs,
      embeddingHits: 0,
      embeddingTokens: 0,
      mapReduceUsage,
      retrievalScore: 0,
    };
  }

  const isList = intent === "list" || wantsDocList(question);
  const isDetail = intent === "detail" || intent === "compare";
  const maxDocs = isDetail ? Math.min(MAX_DOCS_DETAIL, MAX_CONTEXT_DOCS) : MAX_CONTEXT_DOCS;
  const bodyChars = isList
    ? CONTENT_CHARS_LIST
    : isDetail
      ? CONTENT_CHARS_DETAIL
      : CONTENT_CHARS_PER_DOC;
  const maxChunks = isDetail ? MAX_CHUNKS_DETAIL : MAX_CHUNKS_IN_CONTEXT;
  const chunksPerDoc = isDetail ? 6 : 3;

  // Single pinned large doc: map-reduce instead of thin chunk window
  if (
    isDetail &&
    !isList &&
    userId &&
    docs.length === 1 &&
    shouldMapReduce((docs[0]?.content ?? "").replace(/\s+/g, " ").trim().length)
  ) {
    const doc = docs[0]!;
    const mapped = await mapReduceDocumentBody({
      doc,
      userId,
      question,
    });
    const body = mapped.body || "(kosong)";
    return {
      context: `[Dokumen 1] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nRingkasan map-reduce:\n${body}`,
      contextDocs: [doc],
      embeddingHits: 0,
      embeddingTokens: 0,
      mapReduceUsage: mapped.usage,
      retrievalScore: 0,
    };
  }

  // Broad list: rich excerpts scored around query terms (not only doc head)
  if (isList) {
    const take = docs.slice(0, maxDocs);
    const context = take
      .map((doc, i) => {
        const body = bestContentWindow(doc.content ?? "", question, bodyChars, keywords);
        return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
      })
      .join("\n\n---\n\n");
    return { context, contextDocs: take, embeddingHits: 0, embeddingTokens: 0, retrievalScore: 0 };
  }

  if (!userId || !isEmbeddingConfigured()) {
    const take = docs.slice(0, maxDocs);
    const context = take
      .map((doc, i) => {
        const body = bestContentWindow(doc.content ?? "", question, bodyChars, keywords);
        return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
      })
      .join("\n\n---\n\n");
    return { context, contextDocs: take, embeddingHits: 0, embeddingTokens: 0, retrievalScore: 0 };
  }

  const docMap = new Map(docs.map((d) => [d.id, d]));
  const summaries =
    userId ? await loadDocSummaries(userId, docs.map((d) => d.id)) : new Map();

  try {
    const retrieval = await retrieveWithAgentLoop({
      userId,
      allRankedDocs: allRankedDocs ?? docs,
      activeDocs: docs,
      question,
      keywords,
      maxChunks,
      chunksPerDoc,
      maxChunkChars: MAX_CHUNK_CHARS,
    });

    const docsWithChunks = new Set(retrieval.docOrder);
    const fallbackOrder = docs
      .map((d) => d.id)
      .filter((id) => !docsWithChunks.has(id));

    const contextDocs: PaperlessDocument[] = [];
    const parts: string[] = [];
    const seen = new Set<number>();

    const pushDoc = (id: number, body: string) => {
      if (seen.has(id) || contextDocs.length >= maxDocs) return;
      const doc = docMap.get(id);
      if (!doc) return;
      seen.add(id);
      contextDocs.push(doc);
      const i = contextDocs.length;
      const summary = summaries.get(id);
      const summaryLine = summary ? `Ringkasan indeks: ${summary}\n\n` : "";
      parts.push(
        `[Dokumen ${i}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\n${summaryLine}${body}`
      );
    };

    for (const id of retrieval.docOrder) {
      const chunks = retrieval.byDoc.get(id) ?? [];
      pushDoc(
        id,
        `Cuplikan relevan:\n${formatRetrievedSnippets(chunks, MAX_CHUNK_CHARS)}`
      );
    }
    for (const id of fallbackOrder) {
      const doc = docMap.get(id);
      if (!doc) continue;
      pushDoc(
        id,
        `Isi:\n${bestContentWindow(doc.content ?? "", question, bodyChars, keywords) || "(kosong)"}`
      );
    }

    let visionUsage: OpenAiUsageSnapshot | undefined;
    if (isAdmin && contextDocs.length === 1) {
      const vision = await maybeVisionContextForZrb({
        isAdmin: true,
        question,
        keywords,
        doc: contextDocs[0]!,
      });
      if (vision?.context && parts.length > 0) {
        parts[0] = `${parts[0]}\n\n${vision.context}`;
        visionUsage = vision.usage;
      }
    }

    const baseReturn = {
      embeddingHits: retrieval.embeddingHits,
      embeddingTokens: retrieval.embeddingTokens,
      retrievalScore: retrieval.bestScore,
      rerankUsage: retrieval.rerankUsage,
      hydeUsage: retrieval.hydeUsage,
      visionUsage,
    };

    if (parts.length === 0) {
      const take = docs.slice(0, maxDocs);
      return {
        context: take
          .map((doc, i) => {
            const body = bestContentWindow(doc.content ?? "", question, bodyChars, keywords);
            return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
          })
          .join("\n\n---\n\n"),
        contextDocs: take,
        ...baseReturn,
      };
    }

    return {
      context: parts.join("\n\n---\n\n"),
      contextDocs,
      ...baseReturn,
    };
  } catch {
    const take = docs.slice(0, maxDocs);
    return {
      context: take
        .map((doc, i) => {
          const body = bestContentWindow(doc.content ?? "", question, bodyChars, keywords);
          return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
        })
        .join("\n\n---\n\n"),
      contextDocs: take,
      embeddingHits: 0,
      embeddingTokens: 0,
      retrievalScore: 0,
    };
  }
}



export interface ChatCitation {
  id: number;
  title: string;
  fileName: string;
}

export interface ChatResult {
  answer: string;
  citations: ChatCitation[];
  usage?: OpenAiUsageSnapshot;
  confidence?: AskConfidence;
  relatedDocs?: ChatCitation[];
  suggestPin?: boolean;
  retrievalScore?: number;
}

export type AskStreamMeta = {
  confidence: AskConfidence;
  relatedDocs: ChatCitation[];
  suggestPin: boolean;
  retrievalScore: number;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `Kamu asisten Ask AI untuk arsip dokumen organisasi Bappenas.
Jawab HANYA berdasarkan konteks dokumen yang diberikan.
Jika informasi tidak ada di konteks, katakan dengan jujur bahwa tidak ditemukan.

Mode jawaban:
- Pencarian/daftar ("cari", "lihat dokumen tentang", "apa saja", "sebutkan"): cantumkan SEMUA dokumen di konteks. Jangan dipotong jadi 3 kalau konteks berisi 8.
- Tanpa pin @: user mungkin tidak tahu file mana; sebut nama dokumen sumber jelas saat menjawab detail/fakta.
- Detail ("jelaskan", "uraikan", "apa isinya", "poin penting", "keputusan", "analisis"): gali dalam dokumen paling relevan; kutip fakta konkret (tanggal, pihak, nomor surat, agenda, keputusan) bila ada di konteks.
- Analisis ("dampak", "implikasi", "hubungan", pertanyaan tersirat): baca konteks sebagai teks OCR utuh/cuplikan berurutan, inferensi hanya dari bukti di teks; sebut jika jawaban tidak eksplisit di dokumen.
- Perbandingan: hanya dokumen yang diminta; persamaan, perbedaan, kesimpulan.
- Detail / fakta angka ("berapa", "jumlah", "total"): jawab langsung dengan angka atau rentang dari konteks; kutip cuplikan pendek sebagai bukti; sebut halaman jika ada di cuplikan.
- Jangan mengarang. Saat menyebut sumber, pakai field "Nama" (bukan nama file mentah / angka panjang).
- Untuk angka, nama, tanggal: selalu sertakan kutipan singkat dari cuplikan konteks sebagai bukti.

Format daftar (bila >1 dokumen):
1. **Nama dokumen**
Ringkas: 2–4 kalimat. Sertakan bila ada di teks: jenis (undangan/laporan/draft), tanggal atau nomor, agenda/topik, dan satu poin substansi penting.
2. **Nama berikutnya**
Ringkas: ...

Format detail (satu atau sedikit dokumen):
- Mulai dengan jawaban langsung.
- Lanjut poin berbobot (- atau 1. 2.) berisi fakta dari teks.
- Akhiri singkat dengan nama sumber yang dipakai.

Aturan format:
- Numbered list "1. " "2. " saja untuk daftar.
- Jangan heading markdown (# ## ### ####).
- Jangan label "Judul:" / "Isi Singkat:" dengan pagar.
- **tebal** untuk nama dokumen di baris nomor; nama di baris yang sama dengan nomor.
- "Ringkas:" di baris berikutnya tanpa nomor baru.

Jawab Bahasa Indonesia, jelas. Markdown: list, **tebal**, *miring*. Tanpa HTML/heading #.
Pakai riwayat chat untuk pertanyaan lanjutan.`;

function looksImplicitAnalytical(question: string): boolean {
  if (wantsDocList(question)) return false;
  const q = question.toLowerCase();
  if (
    /\b(dampak|implikasi|hubungan|kaitan|terkait|risiko|evaluasi|rekomendasi|masalah|solusi|konteks|latar|signifikansi|peran|fungsi|tujuan|maksud|arti|makna|kesimpulan|temuan|argumen|justifikasi|alasan|bukti|evidence)\b/i.test(
      q
    )
  ) {
    return true;
  }
  if (
    /\b(seberapa|berapa besar|berapa banyak|mengapa|kenapa|bagaimana (jika|kalau|bila|supaya|agar))\b/i.test(
      q
    )
  ) {
    return true;
  }
  const tokens = queryTokens(question);
  return tokens.length >= 4 && /\?/.test(q);
}

function detectIntent(question: string, hasFocus: boolean): AskIntent {
  if (
    /\b(bandingkan|perbandingan|bedakan|persamaan|perbedaan)\b/i.test(question) ||
    (hasFocus && /\b vs \b/i.test(question))
  ) {
    return "compare";
  }
  if (wantsDocList(question)) return "list";
  if (
    hasFocus &&
    (looksImplicitAnalytical(question) ||
      /\b(analisis|evaluasi|dampak|implikasi)\b/i.test(question))
  ) {
    return "analyze";
  }
  if (looksImplicitAnalytical(question)) return "analyze";
  if (
    hasFocus ||
    /\b(detail|jelaskan|uraikan|analisis|poin penting|keputusan|kesimpulan|apa isi|isinya|bagaimana|mengapa|kenapa|ringkas isi|rinci|mendalam)\b/i.test(
      question
    )
  ) {
    return "detail";
  }
  return "default";
}

const ID_NUM: Record<string, number> = {
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
};

function wantsRecency(question: string): boolean {
  return /\b(terbaru|terkini|terakhir|paling baru|recent|baru[- ]baru)\b/i.test(
    question
  );
}

/** Broad search / list: user wants coverage, not a deep dive on one file. */
function wantsDocList(question: string): boolean {
  return (
    /\b(cari|lihat|temukan|sebutkan|daftar|apa saja|apa aja|dokumen tentang|yang terkait|yang relevan|semua)\b/i.test(
      question
    ) &&
    !/\b(bandingkan|perbandingan|ringkas isi|jelaskan detail|analisis mendalam|uraikan|berapa|berapa banyak|berapa besar)\b/i.test(
      question
    )
  );
}

/** e.g. "5 terbaru", "lima dokumen" → 5 */
function extractRequestedLimit(question: string): number | null {
  const digit = question.match(
    /\b(\d{1,2})\s*(terbaru|terkini|dokumen|file|berkas|item|hasil|undangan|rapat)?\b/i
  );
  if (digit) {
    const n = Number(digit[1]);
    if (n >= 1 && n <= MAX_CONTEXT_DOCS) return n;
  }
  const word = question.match(
    /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(terbaru|dokumen|file|berkas|undangan|rapat)?\b/i
  );
  if (word) {
    const n = ID_NUM[word[1].toLowerCase()];
    if (n) return n;
  }
  if (wantsRecency(question)) return 5;
  return null;
}

function queryTokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9à-ü]+/i)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length > 2 &&
        !/^(yang|dan|atau|untuk|dari|dengan|pada|tentang|mengenai|cari|lihat|dokumen|file|pdf|apa|saja|aja|tolong|mohon)$/i.test(
          w
        )
    );
}

/** Merge planner keywords with question tokens for ranking / snippet windows. */
function rankingTokens(question: string, keywords?: string[]): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    const w = t.toLowerCase().trim();
    if (w.length > 2 && !out.includes(w)) out.push(w);
  };
  for (const k of keywords ?? []) {
    for (const t of queryTokens(k)) push(t);
    push(k);
  }
  for (const t of queryTokens(question)) push(t);
  return out.slice(0, 16);
}

/** Prefer a window of OCR text dense with query terms over the document head. */
function bestContentWindow(
  content: string,
  question: string,
  maxChars: number,
  keywords?: string[]
): string {
  const text = (content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const tokens = rankingTokens(question, keywords).slice(0, 12);
  if (tokens.length === 0) return text.slice(0, maxChars);

  const lower = text.toLowerCase();
  let bestStart = 0;
  let bestScore = -1;
  const step = Math.max(80, Math.floor(maxChars / 4));
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + maxChars);
    const window = lower.slice(start, end);
    let score = 0;
    for (const t of tokens) {
      let from = 0;
      while (from < window.length) {
        const i = window.indexOf(t, from);
        if (i === -1) break;
        score += 1 + Math.min(2, t.length / 6);
        from = i + t.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
    if (end >= text.length) break;
  }
  let slice = text.slice(bestStart, bestStart + maxChars);
  if (bestStart > 0) slice = "…" + slice;
  if (bestStart + maxChars < text.length) slice = slice + "…";
  return slice;
}

function contentOverlapScore(
  question: string,
  d: PaperlessDocument,
  keywords?: string[]
): number {
  const scanLen = analysisOverlapScanChars();
  const body = (d.content ?? "").toLowerCase().slice(0, scanLen);
  if (!body) return 0;
  const tokens = rankingTokens(question, keywords).slice(0, 12);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (body.includes(t)) hits += 1;
  }
  return (hits / tokens.length) * 40 + hits * 2;
}

function docLabel(d: PaperlessDocument): string {
  return `${d.title} ${d.original_file_name}`.toLowerCase();
}

/** Higher = better match between question text and document name */
function nameOverlapScore(
  question: string,
  d: PaperlessDocument,
  keywords?: string[]
): number {
  const q = question
    .toLowerCase()
    .replace(/^ringkas isi[:\s]+/i, "")
    .replace(/\.pdf$/i, "");
  const name = docLabel(d).replace(/\.pdf$/i, "");
  if (!name) return 0;

  let score = 0;
  for (const k of keywords ?? []) {
    const kl = k.toLowerCase().trim();
    if (kl.length >= 4 && name.includes(kl)) score += 35;
  }

  if (!q) return score;
  if (name.includes(q.slice(0, 40)) || q.includes(name.slice(0, 40))) {
    return score + 100;
  }
  const words = rankingTokens(question, keywords).filter((w) => w.length > 2);
  if (words.length === 0) return score;
  let hits = 0;
  for (const w of words) {
    if (name.includes(w)) hits += 1;
  }
  return score + (hits / words.length) * 50 + hits;
}

/** Keep only citations that the answer actually refers to. */
export function filterCitationsUsedInAnswer(
  answer: string,
  citations: ChatCitation[]
): ChatCitation[] {
  if (citations.length === 0) return [];
  const text = answer.toLowerCase();

  const used = citations.filter((c) => {
    const label = humanizeFileName(
      (c.title && !/^\d{8,}/.test(c.title) ? c.title : c.fileName) || c.title || ""
    ).toLowerCase();
    const title = (c.title || "").toLowerCase().trim();
    const file = (c.fileName || "").toLowerCase().trim();
    const base = file.replace(/\.pdf$/i, "");

    // Human label tip (most reliable for cleaned names in answers)
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

    // Distinctive tokens only (skip short/common words)
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

  // Soft: only long unique tip from humanized label
  return citations.filter((c) => {
    const label = humanizeFileName(
      (c.title && !/^\d{8,}/.test(c.title) ? c.title : c.fileName) || ""
    ).toLowerCase();
    if (label.length < 14) return false;
    const tip = label.slice(0, 28);
    return text.includes(tip);
  });
}

function toCitation(d: PaperlessDocument): ChatCitation {
  return {
    id: d.id,
    title: displayDocName(d),
    fileName: d.original_file_name,
  };
}

/** Discover docs by filename/path in user's library (scoped), without pin @. */
async function boostCandidatesFromLibraryNames(
  userId: string,
  allowed: Set<number> | null,
  keywords: string[],
  addDoc: (d: PaperlessDocument) => void,
  getDocument: (id: number) => Promise<PaperlessDocument>
): Promise<void> {
  if (keywords.length === 0) return;
  const { prisma } = await import("./prisma");
  const { SyncStatus } = await import("@prisma/client");

  const orConditions = keywords.flatMap((k) => {
    const t = k.trim();
    if (t.length < 3) return [];
    return [
      { fileName: { contains: t, mode: "insensitive" as const } },
      { remotePath: { contains: t, mode: "insensitive" as const } },
    ];
  });
  if (orConditions.length === 0) return;

  const allowedList = allowed ? [...allowed] : undefined;
  if (allowed && allowedList!.length === 0) return;

  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
      ...(allowedList ? { paperlessDocumentId: { in: allowedList } } : {}),
      OR: orConditions,
    },
    select: { paperlessDocumentId: true },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });

  for (const row of rows) {
    const id = row.paperlessDocumentId;
    if (!id) continue;
    try {
      addDoc(await getDocument(id));
    } catch {
      // skip
    }
  }
}

async function resolveDocs(
  question: string,
  allowedDocIds?: number[],
  focusDocIds?: number[],
  userId?: string,
  history: ChatHistoryMessage[] = [],
  conversationId?: string,
  opts?: { skipAutoFocus?: boolean }
): Promise<{
  docs: PaperlessDocument[];
  allRanked: PaperlessDocument[];
  emptyReason?: string;
  searchPlan?: SearchPlan;
  autoFocused?: boolean;
  relatedDocs?: ChatCitation[];
  docScores?: Map<number, number>;
}> {
  if (allowedDocIds && allowedDocIds.length === 0) {
    return {
      docs: [],
      allRanked: [],
      emptyReason:
        "Belum ada dokumen ter-index untuk akun Anda. Ambil PDF lewat Library terlebih dahulu.",
    };
  }

  const { getDocument } = await import("./paperless");
  const allowed = allowedDocIds ? new Set(allowedDocIds) : null;
  const focus = (focusDocIds ?? []).filter(
    (id) => !allowed || allowed.has(id)
  );
  const limit =
    extractRequestedLimit(question) ??
    (wantsRecency(question) ? 5 : MAX_CANDIDATE_DOCS);

  // Pin / compare: only the selected documents
  if (focus.length > 0) {
    const focused: PaperlessDocument[] = [];
    for (const id of focus.slice(0, MAX_CONTEXT_DOCS)) {
      try {
        focused.push(await getDocument(id));
      } catch {
        // skip
      }
    }
    if (focused.length > 0) {
      return { docs: focused, allRanked: focused };
    }
    return {
      docs: [],
      allRanked: [],
      emptyReason:
        "Dokumen yang dipin (@) tidak dapat dibuka. Coba unpin lalu pin lagi, atau periksa akses dokumen di Library.",
    };
  }

  const candidates: PaperlessDocument[] = [];
  const seen = new Set<number>();
  const favoriteIds = new Set<number>();
  const searchPlan = await planDocumentSearch(question, history);
  const searchQueries = searchPlan.queries;
  const searchQ =
    searchPlan.keywords.join(" ") ||
    searchQueries[0] ||
    question.trim();
  const ordering = wantsRecency(question) ? "-created" : undefined;
  const intentPreview = resolveIntent(question, focus.length > 0, searchPlan);
  const isListIntent =
    intentPreview === "list" || wantsDocList(question) || searchPlan.intent === "list";
  const searchPageSize = isListIntent ? 50 : 30;

  const cachedSearch = (q: string, opts?: SearchDocumentsOptions) =>
    cachedSearchDocuments(
      searchDocuments,
      q,
      opts ?? {},
      userId,
      conversationId
    );

  const addDoc = (d: PaperlessDocument) => {
    if (allowed && !allowed.has(d.id)) return;
    if (seen.has(d.id)) return;
    seen.add(d.id);
    candidates.push(d);
  };

  // Multi-query hybrid: full-text + title for each phrasing variant
  for (const q of searchQueries) {
    const [fullText, titleHit] = await Promise.all([
      cachedSearch(q, { page: 1, pageSize: searchPageSize, ordering }),
      cachedSearch(q, {
        page: 1,
        pageSize: Math.min(40, searchPageSize),
        titleOnly: true,
        ordering,
      }),
    ]);
    for (const d of fullText.results) addDoc(d);
    for (const d of titleHit.results) addDoc(d);
  }

  // Scoped filename/path match (Bappenas: UND, MAT, Rapat, ZRB in file names)
  if (userId && searchPlan.keywords.length > 0) {
    await boostCandidatesFromLibraryNames(
      userId,
      allowed,
      searchPlan.keywords,
      addDoc,
      getDocument
    );
  }

  // Also search each planner keyword as title substring
  for (const kw of searchPlan.keywords.slice(0, 4)) {
    if (kw.trim().length < 3) continue;
    const titleHit = await cachedSearch(kw, {
      page: 1,
      pageSize: 25,
      titleOnly: true,
      ordering,
    });
    for (const d of titleHit.results) addDoc(d);
  }

  // Boost docs under favorite folders
  if (userId) {
    try {
      const { prisma } = await import("./prisma");
      const { SyncStatus } = await import("@prisma/client");
      const favs = await prisma.cloudFavorite.findMany({
        where: { userId },
        select: { path: true },
        take: 30,
      });
      if (favs.length > 0) {
        const or = favs.flatMap((f) => {
          const prefix = f.path.endsWith("/") ? f.path : `${f.path}/`;
          return [
            { remotePath: { startsWith: prefix } },
            { remotePath: f.path },
          ];
        });
        const favFiles = await prisma.syncFile.findMany({
          where: {
            userId,
            syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
            paperlessDocumentId: { not: null },
            OR: or,
          },
          select: { paperlessDocumentId: true, fileName: true, remotePath: true },
          take: 40,
        });
        const qWords = searchQ
          .toLowerCase()
          .split(/[^a-z0-9à-ü]+/i)
          .filter((w) => w.length > 2);
        for (const row of favFiles) {
          const id = row.paperlessDocumentId;
          if (!id) continue;
          const hay = `${row.fileName} ${row.remotePath}`.toLowerCase();
          const matches =
            qWords.length === 0 || qWords.some((w) => hay.includes(w));
          if (!matches) continue;
          favoriteIds.add(id);
          if (!seen.has(id)) {
            try {
              addDoc(await getDocument(id));
            } catch {
              // skip
            }
          }
        }
      }
    } catch {
      // favorites optional
    }
  }

  if (candidates.length === 0 && allowedDocIds && allowedDocIds.length > 0) {
    for (const id of allowedDocIds.slice(0, MAX_CONTEXT_DOCS)) {
      try {
        addDoc(await getDocument(id));
      } catch {
        // skip
      }
    }
  }

  if (candidates.length === 0) {
    return {
      docs: [],
      allRanked: [],
      emptyReason:
        "Tidak ada dokumen relevan ditemukan. Coba ubah pertanyaan, pin dokumen dengan @, atau perluas scope.",
    };
  }

  let ranked = wantsRecency(question)
    ? candidates
    : [...candidates].sort((a, b) => {
        const favBoost = (d: PaperlessDocument) =>
          favoriteIds.has(d.id) ? 25 : 0;
        const score = (d: PaperlessDocument) =>
          nameOverlapScore(question, d, searchPlan.keywords) +
          contentOverlapScore(question, d, searchPlan.keywords) +
          favBoost(d);
        return score(b) - score(a);
      });

  const docScores = new Map<number, number>();
  const scoreDoc = (d: PaperlessDocument) => {
    const favBoost = favoriteIds.has(d.id) ? 25 : 0;
    return (
      nameOverlapScore(question, d, searchPlan.keywords) +
      contentOverlapScore(question, d, searchPlan.keywords) +
      favBoost
    );
  };
  for (const d of ranked) docScores.set(d.id, scoreDoc(d));

  if (userId && isEmbeddingConfigured() && ranked.length > 0) {
    const queryText = [question, searchPlan.keywords.join(" ")]
      .join(" ")
      .trim()
      .slice(0, 8000);
    const queryVec = await embedQuery(queryText);
    if (queryVec) {
      const docEmbed = await rankDocsByDocEmbedding(
        userId,
        ranked.slice(0, MAX_CANDIDATE_DOCS),
        queryVec
      );
      const chunkBoost = await bestChunkScoreForDocs(
        userId,
        ranked.slice(0, 25).map((d) => d.id),
        question,
        searchPlan.keywords,
        queryVec
      );
      for (const d of ranked.slice(0, MAX_CANDIDATE_DOCS)) {
        const base = docScores.get(d.id) ?? scoreDoc(d);
        const emb = docEmbed.get(d.id) ?? 0;
        const chunk = (chunkBoost.get(d.id) ?? 0) * 40;
        docScores.set(d.id, base + emb + chunk);
      }
      ranked = [...ranked].sort(
        (a, b) => (docScores.get(b.id) ?? 0) - (docScores.get(a.id) ?? 0)
      );
    }
  }

  ranked = ranked.filter((d) =>
    passesOcrGate(
      d,
      isListIntent,
      nameOverlapScore(question, d, searchPlan.keywords)
    )
  );

  if (ranked.length === 0 && candidates.length > 0) {
    ranked = [...candidates]
      .sort(
        (a, b) =>
          (docScores.get(b.id) ?? scoreDoc(b)) - (docScores.get(a.id) ?? scoreDoc(a))
      )
      .slice(0, MAX_CANDIDATE_DOCS);
  }

  const relatedDocs = ranked.slice(0, 3).map(toCitation);

  const takeN =
    intentPreview === "analyze"
      ? MAX_DOCS_ANALYZE
      : intentPreview === "list" || wantsDocList(question)
        ? MAX_CONTEXT_DOCS
        : intentPreview === "detail" || intentPreview === "compare"
          ? Math.min(MAX_DOCS_DETAIL + 1, limit)
          : Math.min(limit, MAX_CANDIDATE_DOCS);

  const sliced = ranked.slice(0, takeN);
  const { docs: finalDocs, autoFocused } = opts?.skipAutoFocus
    ? { docs: sliced, autoFocused: false }
    : applyAutoFocus(sliced, docScores, intentPreview, focus.length > 0);

  return {
    docs: finalDocs,
    allRanked: ranked,
    searchPlan,
    autoFocused,
    relatedDocs,
    docScores,
  };
}

function buildMessages(
  context: string,
  history: ChatHistoryMessage[],
  question: string,
  contextDocCount: number,
  intent: AskIntent
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const prior = history.slice(-10).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let modeHint = "";
  if (intent === "list" || wantsDocList(question)) {
    modeHint = `\n\nInstruksi tambahan: mode DAFTAR. Konteks berisi ${contextDocCount} dokumen. Cantumkan SEMUA ${contextDocCount} dokumen (masing-masing ada Ringkas 2–4 kalimat berfakta). Jangan hanya 3.`;
  } else if (intent === "analyze") {
    modeHint = `\n\nInstruksi tambahan: mode ANALISIS. Konteks berisi teks OCR utuh/berurutan (bukan ringkasan). Jawab pertanyaan tersirat hanya dari bukti di teks; jika inferensi, tandai sebagai interpretasi. Kutip fakta konkret. Jika jawaban tidak ada di teks, katakan jujur.`;
  } else if (intent === "detail") {
    modeHint = `\n\nInstruksi tambahan: mode DETAIL. Gali dokumen paling relevan. Kutip fakta konkret dari cuplikan (tanggal, nomor, pihak, agenda, keputusan) bila ada. Jawab berstruktur poin, bukan daftar panjang.`;
  } else if (intent === "compare") {
    modeHint = `\n\nInstruksi tambahan: mode PERBANDINGAN. Bandingkan hanya dokumen di konteks: persamaan, perbedaan, lalu kesimpulan singkat.`;
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Konteks dokumen untuk pertanyaan ini:\n\n${context}${modeHint}`,
    },
    ...prior,
    { role: "user", content: question },
  ];
}

function rankingTopScores(docScores: Map<number, number> | undefined, ranked: PaperlessDocument[]): {
  top: number;
  second: number;
} {
  if (!docScores || ranked.length === 0) return { top: 0, second: 0 };
  const top = docScores.get(ranked[0]!.id) ?? 0;
  const second = ranked[1] ? (docScores.get(ranked[1]!.id) ?? 0) : 0;
  return { top, second };
}

function stackAskUsage(
  chatModel: string,
  parts: {
    searchPlan?: SearchPlan;
    mapReduce?: OpenAiUsageSnapshot;
    verify?: OpenAiUsageSnapshot;
    rerank?: OpenAiUsageSnapshot;
    hyde?: OpenAiUsageSnapshot;
    vision?: OpenAiUsageSnapshot;
    chat?: Partial<OpenAiUsageSnapshot>;
  }
): OpenAiUsageSnapshot {
  let u = parts.searchPlan?.usage ?? emptyUsage(chatModel);
  if (parts.mapReduce) u = mergeUsage(u, parts.mapReduce);
  if (parts.verify) u = mergeUsage(u, parts.verify);
  if (parts.rerank) u = mergeUsage(u, parts.rerank);
  if (parts.hyde) u = mergeUsage(u, parts.hyde);
  if (parts.vision) u = mergeUsage(u, parts.vision);
  if (parts.chat) {
    u = mergeUsage(u, {
      model: chatModel,
      ...parts.chat,
    });
  }
  return u;
}

export async function askDocuments(
  question: string,
  allowedDocIds?: number[],
  history: ChatHistoryMessage[] = [],
  focusDocIds?: number[],
  userId?: string,
  conversationId?: string,
  isAdmin?: boolean
): Promise<ChatResult> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "OpenAI belum dikonfigurasi. Isi OPENAI_API_KEY di file .env"
    );
  }

  const {
    docs,
    allRanked,
    emptyReason,
    searchPlan,
    autoFocused,
    relatedDocs,
    docScores,
  } = await resolveDocs(
    question,
    allowedDocIds,
    focusDocIds,
    userId,
    history,
    conversationId
  );
  if (docs.length === 0) {
    return {
      answer: emptyReason ?? "Tidak ada dokumen.",
      citations: [],
      usage: searchPlan?.usage ?? emptyUsage(model),
    };
  }

  const hasFocus = (focusDocIds?.length ?? 0) > 0;
  const intent = resolveIntent(
    question,
    !!(hasFocus || autoFocused),
    searchPlan,
    autoFocused
  );
  const {
    context,
    contextDocs,
    embeddingHits,
    embeddingTokens,
    mapReduceUsage,
    retrievalScore,
    rerankUsage,
    hydeUsage,
    visionUsage,
  } = await buildContext(
    docs,
    question,
    userId,
    intent,
    searchPlan?.keywords,
    allRanked,
    isAdmin
  );
  const listMode = intent === "list" || wantsDocList(question);
  const chatModelUsed = chatModelForIntent(intent);
  const maxTokens =
    intent === "analyze"
      ? 3200
      : listMode
        ? 2200
        : intent === "detail"
          ? 2000
          : 1600;

  const completion = await client.chat.completions.create({
    model: chatModelUsed,
    messages: buildMessages(
      context,
      history,
      question,
      contextDocs.length,
      intent
    ),
    temperature: 0.2,
    max_tokens: maxTokens,
  });

  let answer =
    completion.choices[0]?.message?.content ??
    "Maaf, tidak dapat menghasilkan jawaban.";

  let verifyUsage: OpenAiUsageSnapshot | undefined;
  if (shouldVerifyAnswer(intent, question)) {
    const verified = await verifyAnswerAgainstContext({
      context,
      question,
      answer,
    });
    answer = verified.answer;
    verifyUsage = verified.usage;
  }

  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const usage = stackAskUsage(chatModelUsed, {
    searchPlan,
    mapReduce: mapReduceUsage,
    verify: verifyUsage,
    rerank: rerankUsage,
    hyde: hydeUsage,
    vision: visionUsage,
    chat: {
      promptTokens,
      completionTokens,
      embeddingHits,
      embeddingTokens,
      chatHits: 1,
    },
  });

  const rankScores = rankingTopScores(docScores, allRanked);
  const confidence = computeAskConfidence(
    retrievalScore,
    rankScores.top,
    rankScores.second
  );
  const suggestPin = shouldSuggestPin(confidence, hasFocus, intent);

  const all = contextDocs.map(toCitation);
  return {
    answer,
    citations: listMode
      ? all
      : filterCitationsUsedInAnswer(answer, all),
    usage,
    confidence,
    relatedDocs: relatedDocs ?? [],
    suggestPin,
    retrievalScore,
  };
}

/** Stream answer tokens; final citations = sources actually used in the answer. */
export async function askDocumentsStream(
  question: string,
  allowedDocIds: number[] | undefined,
  history: ChatHistoryMessage[],
  onToken: (token: string) => void,
  focusDocIds?: number[],
  onDocsResolved?: (citations: ChatCitation[]) => void,
  userId?: string,
  onReplace?: (content: string) => void,
  conversationId?: string,
  isAdmin?: boolean,
  onMeta?: (meta: AskStreamMeta) => void
): Promise<ChatResult> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "OpenAI belum dikonfigurasi. Isi OPENAI_API_KEY di file .env"
    );
  }

  const {
    docs,
    allRanked,
    emptyReason,
    searchPlan,
    autoFocused,
    relatedDocs,
    docScores,
  } = await resolveDocs(
    question,
    allowedDocIds,
    focusDocIds,
    userId,
    history,
    conversationId
  );

  const hasFocus = (focusDocIds?.length ?? 0) > 0;
  const intent = resolveIntent(
    question,
    !!(hasFocus || autoFocused),
    searchPlan,
    autoFocused
  );
  const {
    context,
    contextDocs,
    embeddingHits,
    embeddingTokens,
    mapReduceUsage,
    retrievalScore,
    rerankUsage,
    hydeUsage,
    visionUsage,
  } = await buildContext(
    docs,
    question,
    userId,
    intent,
    searchPlan?.keywords,
    allRanked,
    isAdmin
  );
  const listMode = intent === "list" || wantsDocList(question);
  const chatModelUsed = chatModelForIntent(intent);
  const candidateCitations = (
    contextDocs.length > 0 ? contextDocs : docs.slice(0, MAX_CONTEXT_DOCS)
  ).map(toCitation);

  const rankScores = rankingTopScores(docScores, allRanked);
  const confidence = computeAskConfidence(
    retrievalScore,
    rankScores.top,
    rankScores.second
  );
  const suggestPin = shouldSuggestPin(confidence, hasFocus, intent);
  onMeta?.({
    confidence,
    relatedDocs: relatedDocs ?? [],
    suggestPin,
    retrievalScore,
  });

  onDocsResolved?.(relatedDocs?.length ? relatedDocs : candidateCitations);

  if (docs.length === 0) {
    const answer = emptyReason ?? "Tidak ada dokumen.";
    onToken(answer);
    return {
      answer,
      citations: [],
      usage: searchPlan?.usage ?? emptyUsage(chatModelUsed),
      confidence: "low",
      relatedDocs: [],
      suggestPin: false,
      retrievalScore: 0,
    };
  }

  const stream = await client.chat.completions.create({
    model: chatModelUsed,
    messages: buildMessages(
      context,
      history,
      question,
      contextDocs.length,
      intent
    ),
    temperature: 0.2,
    max_tokens: listMode
      ? 2400
      : intent === "analyze"
        ? 3200
        : intent === "detail"
          ? 2000
          : 1600,
    stream: true,
    stream_options: { include_usage: true },
  });

  let answer = "";
  let promptTokens = 0;
  let completionTokens = 0;
  for await (const chunk of stream) {
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
      completionTokens = chunk.usage.completion_tokens ?? completionTokens;
    }
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      answer += delta;
      onToken(delta);
    }
  }

  if (!answer) {
    answer = "Maaf, tidak dapat menghasilkan jawaban.";
    onToken(answer);
  }

  const streamedAnswer = answer.trim();
  let verifyUsage: OpenAiUsageSnapshot | undefined;
  if (shouldVerifyAnswer(intent, question)) {
    const verified = await verifyAnswerAgainstContext({
      context,
      question,
      answer: streamedAnswer,
    });
    answer = verified.answer.trim();
    verifyUsage = verified.usage;
    if (answer !== streamedAnswer) {
      if (answer.startsWith(streamedAnswer)) {
        const suffix = answer.slice(streamedAnswer.length).trim();
        if (suffix) {
          const token = suffix.startsWith("\n") ? suffix : `\n\n${suffix}`;
          onToken(token);
        }
      } else if (onReplace) {
        onReplace(answer);
      } else {
        onToken(`\n\n${answer}`);
      }
    }
  } else {
    answer = streamedAnswer;
  }

  if (promptTokens === 0 && completionTokens === 0) {
    promptTokens = estimateTokens(context) + estimateTokens(question);
    completionTokens = estimateTokens(answer);
  }

  const usage = stackAskUsage(chatModelUsed, {
    searchPlan,
    mapReduce: mapReduceUsage,
    verify: verifyUsage,
    rerank: rerankUsage,
    hyde: hydeUsage,
    vision: visionUsage,
    chat: {
      promptTokens,
      completionTokens,
      embeddingHits,
      embeddingTokens,
      chatHits: 1,
    },
  });

  const citations = listMode
    ? candidateCitations
    : filterCitationsUsedInAnswer(answer, candidateCitations);
  return {
    answer,
    citations,
    usage,
    confidence,
    relatedDocs: relatedDocs ?? [],
    suggestPin,
    retrievalScore,
  };
}

export async function evaluateAskRetrieval(
  question: string,
  allowedDocIds?: number[],
  focusDocIds?: number[],
  userId?: string
): Promise<{ retrievedIds: number[]; searchPlan?: SearchPlan }> {
  const { allRanked, searchPlan } = await resolveDocs(
    question,
    allowedDocIds,
    focusDocIds,
    userId,
    [],
    undefined,
    { skipAutoFocus: true }
  );
  return { retrievedIds: allRanked.map((d) => d.id), searchPlan };
}

export function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "New chat";
  return `${clean.slice(0, 48).trim()}...`;
}
