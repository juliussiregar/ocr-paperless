import OpenAI from "openai";
import { searchDocuments, type PaperlessDocument } from "./paperless";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const MAX_CONTEXT_DOCS = 8;
const CONTENT_CHARS_PER_DOC = 2800;

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

export function isOpenAiConfigured(): boolean {
  return !!getClient();
}

function buildContext(docs: PaperlessDocument[]): string {
  return docs
    .map(
      (doc, i) =>
        `[Dokumen ${i + 1}] Judul: ${doc.title}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${doc.content?.slice(0, CONTENT_CHARS_PER_DOC) ?? "(kosong)"}`
    )
    .join("\n\n---\n\n");
}

export interface ChatCitation {
  id: number;
  title: string;
  fileName: string;
}

export interface ChatResult {
  answer: string;
  citations: ChatCitation[];
}

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `Kamu asisten Ask AI untuk arsip dokumen organisasi Bappenas.
Jawab HANYA berdasarkan konteks dokumen yang diberikan.
Jika informasi tidak ada di konteks, katakan dengan jujur bahwa tidak ditemukan.

Pilih sendiri berapa dokumen yang relevan untuk jawaban:
- Jika pertanyaan spesifik ke satu berkas/topik sempit, fokus ke 1 dokumen paling cocok.
- Jika pertanyaan meminta daftar, beberapa item, "apa saja", "terbaru", ringkasan lintas dokumen, atau topik yang muncul di banyak berkas, gunakan beberapa dokumen yang relevan.
- Jangan mengarang sumber yang tidak ada di konteks.
- Saat menyebut sumber, tulis Judul atau nama File PERSIS seperti di konteks (boleh singkat tapi harus bisa dikenali).

Jika diminta membandingkan dua dokumen, buat perbandingan terstruktur (persamaan, perbedaan, kesimpulan).
Jawab dalam Bahasa Indonesia, ringkas dan jelas.
Format jawaban dengan Markdown ringan: heading ## atau ### bila perlu, bullet (- ) untuk poin, **tebal** untuk istilah penting. Jangan pakai HTML.
Gunakan riwayat percakapan untuk memahami pertanyaan lanjutan.`;

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
    const title = (c.title || "").toLowerCase().trim();
    const file = (c.fileName || "").toLowerCase().trim();
    const base = file.replace(/\.pdf$/i, "");

    if (title.length >= 6) {
      const tip = title.slice(0, Math.min(48, title.length));
      if (text.includes(tip)) return true;
    }
    if (file.length >= 6 && text.includes(file)) return true;
    if (base.length >= 6 && text.includes(base)) return true;

    const tokens = `${title} ${base}`
      .split(/[^a-z0-9à-ü]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 5);
    const hits = tokens.filter((t) => text.includes(t)).length;
    return hits >= 2 || (tokens.length === 1 && hits === 1);
  });

  if (used.length > 0) return used;

  // Soft fallback: any distinctive token hit
  const soft = citations.filter((c) => {
    const tokens = `${c.title} ${c.fileName}`
      .toLowerCase()
      .split(/[^a-z0-9à-ü]+/i)
      .filter((t) => t.length >= 6);
    return tokens.some((t) => text.includes(t));
  });
  return soft;
}

function toCitation(d: PaperlessDocument): ChatCitation {
  return {
    id: d.id,
    title: d.title,
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
    (wantsRecency(question) ? 5 : MAX_CONTEXT_DOCS);

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
  const searchQ = extractSearchQuery(question);
  const ordering = wantsRecency(question) ? "-created" : undefined;

  const addDoc = (d: PaperlessDocument) => {
    if (allowed && !allowed.has(d.id)) return;
    if (seen.has(d.id)) return;
    seen.add(d.id);
    candidates.push(d);
  };

  // Hybrid: full-text + title substring
  const [fullText, titleHit] = await Promise.all([
    searchDocuments(searchQ, { page: 1, pageSize: 25, ordering }),
    searchDocuments(searchQ, {
      page: 1,
      pageSize: 25,
      titleOnly: true,
      ordering,
    }),
  ]);
  for (const d of fullText.results) addDoc(d);
  for (const d of titleHit.results) addDoc(d);

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
        return (
          nameOverlapScore(question, b) +
          favBoost(b) -
          (nameOverlapScore(question, a) + favBoost(a))
        );
      });

  return { docs: ranked.slice(0, Math.min(limit, MAX_CONTEXT_DOCS)) };
}

function buildMessages(
  docs: PaperlessDocument[],
  history: ChatHistoryMessage[],
  question: string
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const context = buildContext(docs);
  const prior = history.slice(-10).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `Konteks dokumen untuk pertanyaan ini:\n\n${context}`,
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
    return { answer: emptyReason ?? "Tidak ada dokumen.", citations: [] };
  }

  const completion = await client.chat.completions.create({
    model,
    messages: buildMessages(docs, history, question),
    temperature: 0.2,
    max_tokens: 1000,
  });

  const answer =
    completion.choices[0]?.message?.content ??
    "Maaf, tidak dapat menghasilkan jawaban.";

  const all = docs.map(toCitation);
  return {
    answer,
    citations: filterCitationsUsedInAnswer(answer, all),
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

  const candidateCitations = docs.map(toCitation);
  // Reading status: candidates under consideration
  onDocsResolved?.(candidateCitations);

  if (docs.length === 0) {
    const answer = emptyReason ?? "Tidak ada dokumen.";
    onToken(answer);
    return { answer, citations: [] };
  }

  const stream = await client.chat.completions.create({
    model,
    messages: buildMessages(docs, history, question),
    temperature: 0.2,
    max_tokens: 1200,
    stream: true,
  });

  let answer = "";
  for await (const chunk of stream) {
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

  const citations = filterCitationsUsedInAnswer(answer, candidateCitations);
  return { answer, citations };
}

export function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "New chat";
  return `${clean.slice(0, 48).trim()}...`;
}
