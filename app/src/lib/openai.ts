import OpenAI from "openai";
import { searchDocuments, type PaperlessDocument } from "./paperless";
import {
  cosineSimilarity,
  embedQuery,
  estimateTokens,
  isEmbeddingConfigured,
} from "./embeddings";
import { humanizeFileName } from "./display-name";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";

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

type RankedChunk = {
  paperlessDocumentId: number;
  content: string;
  score: number;
  chunkIndex: number;
};

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
  userId: string | undefined
): Promise<{ context: string; contextDocs: PaperlessDocument[] }> {
  const maxChars = fullDocMaxChars();
  const take = docs.slice(0, MAX_DOCS_ANALYZE);
  const parts: string[] = [];
  for (let i = 0; i < take.length; i++) {
    const doc = take[i]!;
    const body = await buildFullDocumentBody(doc, userId, maxChars);
    parts.push(
      `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nTeks OCR (utuh, berurutan):\n${body || "(kosong)"}`
    );
  }
  return { context: parts.join("\n\n---\n\n"), contextDocs: take };
}

/**
 * Hybrid: rank stored chunks by cosine vs question among candidate docs.
 * List/search questions prefer breadth (all candidates) over deep chunks.
 */
async function buildContext(
  docs: PaperlessDocument[],
  question: string,
  userId?: string,
  intent: AskIntent = "default"
): Promise<{
  context: string;
  contextDocs: PaperlessDocument[];
  embeddingHits: number;
  embeddingTokens: number;
}> {
  if (docs.length === 0) {
    return { context: "", contextDocs: [], embeddingHits: 0, embeddingTokens: 0 };
  }

  if (intent === "analyze") {
    const { context, contextDocs } = await buildAnalyzeContext(docs, userId);
    return {
      context,
      contextDocs,
      embeddingHits: 0,
      embeddingTokens: 0,
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

  // Broad list: rich excerpts scored around query terms (not only doc head)
  if (isList) {
    const take = docs.slice(0, maxDocs);
    const context = take
      .map((doc, i) => {
        const body = bestContentWindow(doc.content ?? "", question, bodyChars);
        return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
      })
      .join("\n\n---\n\n");
    return { context, contextDocs: take, embeddingHits: 0, embeddingTokens: 0 };
  }

  if (!userId || !isEmbeddingConfigured()) {
    const take = docs.slice(0, maxDocs);
    const context = take
      .map((doc, i) => {
        const body = bestContentWindow(doc.content ?? "", question, bodyChars);
        return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
      })
      .join("\n\n---\n\n");
    return { context, contextDocs: take, embeddingHits: 0, embeddingTokens: 0 };
  }

  const docIds = docs.map((d) => d.id);
  const docMap = new Map(docs.map((d) => [d.id, d]));
  let embeddingHits = 0;
  let embeddingTokens = 0;

  try {
    const { prisma } = await import("./prisma");
    const rows = await prisma.documentChunk.findMany({
      where: {
        userId,
        paperlessDocumentId: { in: docIds },
      },
      select: {
        paperlessDocumentId: true,
        content: true,
        embedding: true,
        chunkIndex: true,
      },
      take: 3000,
    });

    const docsWithChunks = new Set(rows.map((r) => r.paperlessDocumentId));
    let queryVec: number[] | null = null;
    if (rows.length > 0) {
      queryVec = await embedQuery(question);
      if (queryVec) {
        embeddingHits = 1;
        embeddingTokens = estimateTokens(question.slice(0, 8000));
      }
    }

    const byDocSnippets = new Map<number, string[]>();
    const chunkOrder: number[] = [];
    const docBestScore = new Map<number, number>();
    const pickedChunkKeys = new Set<string>();

    const pickChunk = (
      paperlessDocumentId: number,
      content: string,
      chunkIndex: number
    ) => {
      const key = `${paperlessDocumentId}:${chunkIndex}`;
      if (pickedChunkKeys.has(key)) return;
      if (!byDocSnippets.has(paperlessDocumentId)) {
        byDocSnippets.set(paperlessDocumentId, []);
        chunkOrder.push(paperlessDocumentId);
      }
      const bag = byDocSnippets.get(paperlessDocumentId)!;
      if (bag.length >= chunksPerDoc) return;
      pickedChunkKeys.add(key);
      bag.push(content.slice(0, MAX_CHUNK_CHARS));
    };

    if (queryVec && rows.length > 0) {
      const ranked: RankedChunk[] = [];
      const rowByDocIdx = new Map<string, { content: string; chunkIndex: number }>();
      for (const row of rows) {
        rowByDocIdx.set(
          `${row.paperlessDocumentId}:${row.chunkIndex}`,
          { content: row.content, chunkIndex: row.chunkIndex }
        );
        const emb = row.embedding;
        if (!Array.isArray(emb) || emb.length === 0) continue;
        const score = cosineSimilarity(queryVec, emb as number[]);
        ranked.push({
          paperlessDocumentId: row.paperlessDocumentId,
          content: row.content,
          score,
          chunkIndex: row.chunkIndex,
        });
        const prev = docBestScore.get(row.paperlessDocumentId) ?? -1;
        if (score > prev) docBestScore.set(row.paperlessDocumentId, score);
      }
      ranked.sort((a, b) => b.score - a.score);
      for (const c of ranked.slice(0, maxChunks)) {
        pickChunk(c.paperlessDocumentId, c.content, c.chunkIndex);
        for (const neighbor of [-1, 1]) {
          const adj = rowByDocIdx.get(
            `${c.paperlessDocumentId}:${c.chunkIndex + neighbor}`
          );
          if (adj) {
            pickChunk(
              c.paperlessDocumentId,
              adj.content,
              c.chunkIndex + neighbor
            );
          }
        }
      }
      // Prefer docs with stronger chunk hits first
      chunkOrder.sort(
        (a, b) => (docBestScore.get(b) ?? 0) - (docBestScore.get(a) ?? 0)
      );
    }

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
      parts.push(
        `[Dokumen ${i}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\n${body}`
      );
    };

    for (const id of chunkOrder) {
      const snippets = byDocSnippets.get(id) ?? [];
      pushDoc(
        id,
        `Cuplikan relevan:\n${snippets.join("\n\n…\n\n")}`
      );
    }
    for (const id of fallbackOrder) {
      const doc = docMap.get(id);
      if (!doc) continue;
      pushDoc(
        id,
        `Isi:\n${bestContentWindow(doc.content ?? "", question, bodyChars) || "(kosong)"}`
      );
    }

    if (parts.length === 0) {
      const take = docs.slice(0, maxDocs);
      return {
        context: take
          .map((doc, i) => {
            const body = bestContentWindow(doc.content ?? "", question, bodyChars);
            return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
          })
          .join("\n\n---\n\n"),
        contextDocs: take,
        embeddingHits,
        embeddingTokens,
      };
    }

    return {
      context: parts.join("\n\n---\n\n"),
      contextDocs,
      embeddingHits,
      embeddingTokens,
    };
  } catch {
    const take = docs.slice(0, maxDocs);
    return {
      context: take
        .map((doc, i) => {
          const body = bestContentWindow(doc.content ?? "", question, bodyChars);
          return `[Dokumen ${i + 1}] Nama: ${displayDocName(doc)}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${body || "(kosong)"}`;
        })
        .join("\n\n---\n\n"),
      contextDocs: take,
      embeddingHits,
      embeddingTokens,
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
}

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `Kamu asisten Ask AI untuk arsip dokumen organisasi Bappenas.
Jawab HANYA berdasarkan konteks dokumen yang diberikan.
Jika informasi tidak ada di konteks, katakan dengan jujur bahwa tidak ditemukan.

Mode jawaban:
- Pencarian/daftar ("cari", "lihat dokumen tentang", "apa saja", "sebutkan"): cantumkan SEMUA dokumen di konteks. Jangan dipotong jadi 3 kalau konteks berisi 8.
- Detail ("jelaskan", "uraikan", "apa isinya", "poin penting", "keputusan", "analisis"): gali dalam dokumen paling relevan; kutip fakta konkret (tanggal, pihak, nomor surat, agenda, keputusan) bila ada di konteks.
- Analisis ("dampak", "implikasi", "hubungan", pertanyaan tersirat): baca konteks sebagai teks OCR utuh/cuplikan berurutan, inferensi hanya dari bukti di teks; sebut jika jawaban tidak eksplisit di dokumen.
- Perbandingan: hanya dokumen yang diminta; persamaan, perbedaan, kesimpulan.
- Jangan mengarang. Saat menyebut sumber, pakai field "Nama" (bukan nama file mentah / angka panjang).

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
    /\b(cari|lihat|temukan|sebutkan|daftar|apa saja|apa aja|dokumen tentang|yang terkait|yang relevan|semua|berapa)\b/i.test(
      question
    ) &&
    !/\b(bandingkan|perbandingan|ringkas isi|jelaskan detail|analisis mendalam|uraikan)\b/i.test(
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

function extractSearchQuery(question: string): string {
  const cleaned = question
    .replace(
      /\b(saya mau|tolong|mohon|bisa|lihat|cari|ada|sebutkan|daftar|ringkas|jelaskan)\b/gi,
      " "
    )
    .replace(
      /\b(dokumen|file|pdf|arsip)?\s*(tentang|mengenai|terkait|soal)\b/gi,
      " "
    )
    .replace(
      /\b(apa saja|apa aja|yang|berapa|\d+|lima|terbaru|terkini|terakhir)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : question.trim();
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

/** Prefer a window of OCR text dense with query terms over the document head. */
function bestContentWindow(content: string, question: string, maxChars: number): string {
  const text = (content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const tokens = queryTokens(question).slice(0, 12);
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

function contentOverlapScore(question: string, d: PaperlessDocument): number {
  const scanLen = analysisOverlapScanChars();
  const body = (d.content ?? "").toLowerCase().slice(0, scanLen);
  if (!body) return 0;
  const tokens = queryTokens(question).slice(0, 10);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (body.includes(t)) hits += 1;
  }
  return (hits / tokens.length) * 40 + hits * 2;
}

/** Extra Paperless queries to catch alternate phrasing / partial titles. */
function expandSearchQueries(question: string): string[] {
  const primary = extractSearchQuery(question);
  const out: string[] = [];
  const push = (q: string) => {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length >= 3 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) {
      out.push(t);
    }
  };
  push(primary);
  const tokens = queryTokens(primary);
  if (tokens.length >= 3) {
    push(tokens.slice(0, 4).join(" "));
    push(tokens.slice(-3).join(" "));
  }
  if (tokens.length >= 2) {
    push(tokens.join(" "));
  }
  // Keep longest distinctive phrase (often the topic)
  const quoted = question.match(/["“](.+?)["”]/);
  if (quoted?.[1]) push(quoted[1]);
  return out.slice(0, 4);
}

function docLabel(d: PaperlessDocument): string {
  return `${d.title} ${d.original_file_name}`.toLowerCase();
}

/** Higher = better match between question text and document name */
function nameOverlapScore(question: string, d: PaperlessDocument): number {
  const q = question
    .toLowerCase()
    .replace(/^ringkas isi[:\s]+/i, "")
    .replace(/\.pdf$/i, "");
  const name = docLabel(d).replace(/\.pdf$/i, "");
  if (!q || !name) return 0;
  if (name.includes(q.slice(0, 40)) || q.includes(name.slice(0, 40))) return 100;
  const words = q
    .split(/[^a-z0-9à-ü]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  let hits = 0;
  for (const w of words) {
    if (name.includes(w)) hits += 1;
  }
  return (hits / words.length) * 50 + hits;
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

async function resolveDocs(
  question: string,
  allowedDocIds?: number[],
  focusDocIds?: number[],
  userId?: string
): Promise<{ docs: PaperlessDocument[]; emptyReason?: string }> {
  if (allowedDocIds && allowedDocIds.length === 0) {
    return {
      docs: [],
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
    if (focused.length > 0) return { docs: focused };
  }

  const candidates: PaperlessDocument[] = [];
  const seen = new Set<number>();
  const favoriteIds = new Set<number>();
  const searchQueries = expandSearchQueries(question);
  const searchQ = searchQueries[0] ?? extractSearchQuery(question);
  const ordering = wantsRecency(question) ? "-created" : undefined;
  const intent = detectIntent(question, focus.length > 0);

  const addDoc = (d: PaperlessDocument) => {
    if (allowed && !allowed.has(d.id)) return;
    if (seen.has(d.id)) return;
    seen.add(d.id);
    candidates.push(d);
  };

  // Multi-query hybrid: full-text + title for each phrasing variant
  for (const q of searchQueries) {
    const [fullText, titleHit] = await Promise.all([
      searchDocuments(q, { page: 1, pageSize: 25, ordering }),
      searchDocuments(q, {
        page: 1,
        pageSize: 20,
        titleOnly: true,
        ordering,
      }),
    ]);
    for (const d of fullText.results) addDoc(d);
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
      emptyReason:
        "Tidak ada dokumen relevan ditemukan. Coba ubah pertanyaan, pin dokumen dengan @, atau perluas scope.",
    };
  }

  const ranked = wantsRecency(question)
    ? candidates
    : [...candidates].sort((a, b) => {
        const favBoost = (d: PaperlessDocument) =>
          favoriteIds.has(d.id) ? 25 : 0;
        const score = (d: PaperlessDocument) =>
          nameOverlapScore(question, d) +
          contentOverlapScore(question, d) +
          favBoost(d);
        return score(b) - score(a);
      });

  const takeN =
    intent === "analyze"
      ? MAX_DOCS_ANALYZE
      : intent === "list" || wantsDocList(question)
        ? MAX_CONTEXT_DOCS
        : intent === "detail" || intent === "compare"
          ? Math.min(MAX_DOCS_DETAIL + 1, limit)
          : Math.min(limit, MAX_CANDIDATE_DOCS);

  return {
    docs: ranked.slice(0, takeN),
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

export async function askDocuments(
  question: string,
  allowedDocIds?: number[],
  history: ChatHistoryMessage[] = [],
  focusDocIds?: number[],
  userId?: string
): Promise<ChatResult> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "OpenAI belum dikonfigurasi. Isi OPENAI_API_KEY di file .env"
    );
  }

  const { docs, emptyReason } = await resolveDocs(
    question,
    allowedDocIds,
    focusDocIds,
    userId
  );
  if (docs.length === 0) {
    return {
      answer: emptyReason ?? "Tidak ada dokumen.",
      citations: [],
      usage: emptyUsage(model),
    };
  }

  const intent = detectIntent(question, (focusDocIds?.length ?? 0) > 0);
  const { context, contextDocs, embeddingHits, embeddingTokens } =
    await buildContext(docs, question, userId, intent);
  const listMode = intent === "list" || wantsDocList(question);
  const maxTokens =
    intent === "analyze"
      ? 3200
      : listMode
        ? 2200
        : intent === "detail"
          ? 2000
          : 1600;

  const completion = await client.chat.completions.create({
    model,
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

  const answer =
    completion.choices[0]?.message?.content ??
    "Maaf, tidak dapat menghasilkan jawaban.";

  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const usage = mergeUsage(emptyUsage(model), {
    model,
    promptTokens,
    completionTokens,
    embeddingHits,
    embeddingTokens,
    chatHits: 1,
  });

  const all = contextDocs.map(toCitation);
  return {
    answer,
    citations: listMode
      ? all
      : filterCitationsUsedInAnswer(answer, all),
    usage,
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
  userId?: string
): Promise<ChatResult> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "OpenAI belum dikonfigurasi. Isi OPENAI_API_KEY di file .env"
    );
  }

  const { docs, emptyReason } = await resolveDocs(
    question,
    allowedDocIds,
    focusDocIds,
    userId
  );

  const intent = detectIntent(question, (focusDocIds?.length ?? 0) > 0);
  const { context, contextDocs, embeddingHits, embeddingTokens } =
    await buildContext(docs, question, userId, intent);
  const listMode = intent === "list" || wantsDocList(question);
  const candidateCitations = (
    contextDocs.length > 0 ? contextDocs : docs.slice(0, MAX_CONTEXT_DOCS)
  ).map(toCitation);
  // Reading status: candidates under consideration
  onDocsResolved?.(candidateCitations);

  if (docs.length === 0) {
    const answer = emptyReason ?? "Tidak ada dokumen.";
    onToken(answer);
    return { answer, citations: [], usage: emptyUsage(model) };
  }

  const stream = await client.chat.completions.create({
    model,
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

  // Fallback estimate if provider omitted stream usage
  if (promptTokens === 0 && completionTokens === 0) {
    promptTokens = estimateTokens(context) + estimateTokens(question);
    completionTokens = estimateTokens(answer);
  }

  const usage = mergeUsage(emptyUsage(model), {
    model,
    promptTokens,
    completionTokens,
    embeddingHits,
    embeddingTokens,
    chatHits: 1,
  });

  const citations = listMode
    ? candidateCitations
    : filterCitationsUsedInAnswer(answer, candidateCitations);
  return { answer, citations, usage };
}

export function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "New chat";
  return `${clean.slice(0, 48).trim()}...`;
}
