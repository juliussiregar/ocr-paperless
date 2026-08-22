import OpenAI from "openai";
import { searchDocuments, type PaperlessDocument } from "./paperless";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

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
        `[Dokumen ${i + 1}] Judul: ${doc.title}\nFile: ${doc.original_file_name}\nID: ${doc.id}\nIsi:\n${doc.content?.slice(0, 3000) ?? "(kosong)"}`
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
Sebut sumber dokumen (judul/nama file) saat menjawab.
Jika hanya ada satu dokumen di konteks, fokus pada dokumen itu saja. Jangan mengarang sumber lain.
Jika diminta membandingkan dua dokumen, buat perbandingan yang terstruktur (persamaan, perbedaan, kesimpulan).
Jawab dalam Bahasa Indonesia, ringkas dan jelas.
Format jawaban dengan Markdown ringan: heading ## atau ### bila perlu, bullet (- ) untuk poin, **tebal** untuk istilah penting. Jangan pakai HTML.
Gunakan riwayat percakapan untuk memahami pertanyaan lanjutan.`;

function wantsMultipleSources(question: string, focusCount: number): boolean {
  if (focusCount > 1) return true;
  const q = question.toLowerCase();
  return /\b(bandingkan|banding|compare|persamaan|perbedaan|kedua dokumen|kedua file|dua dokumen|dua file|semua dokumen|beberapa dokumen)\b/i.test(
    q
  );
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

async function resolveDocs(
  question: string,
  allowedDocIds?: number[],
  focusDocIds?: number[]
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
  const multi = wantsMultipleSources(question, focus.length);

  // Pin / suggestion / compare: hanya dokumen yang dipilih
  if (focus.length > 0) {
    const focused: PaperlessDocument[] = [];
    for (const id of focus.slice(0, 5)) {
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
  const searchResult = await searchDocuments(question, 1);
  for (const d of searchResult.results) {
    if (allowed && !allowed.has(d.id)) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    candidates.push(d);
  }

  if (candidates.length === 0 && allowedDocIds && allowedDocIds.length > 0) {
    for (const id of allowedDocIds.slice(0, 8)) {
      try {
        const d = await getDocument(id);
        if (!seen.has(d.id)) {
          seen.add(d.id);
          candidates.push(d);
        }
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

  const ranked = [...candidates].sort(
    (a, b) => nameOverlapScore(question, b) - nameOverlapScore(question, a)
  );

  // Default chatbot: 1 file terbaik. Multi hanya jika pertanyaan jelas multi-dokumen.
  if (!multi) {
    return { docs: [ranked[0]] };
  }

  return { docs: ranked.slice(0, 3) };
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
  focusDocIds?: number[]
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
    focusDocIds
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

  return {
    answer,
    citations: docs.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.original_file_name,
    })),
  };
}

/** Stream answer tokens; returns citations once docs are resolved. */
export async function askDocumentsStream(
  question: string,
  allowedDocIds: number[] | undefined,
  history: ChatHistoryMessage[],
  onToken: (token: string) => void,
  focusDocIds?: number[],
  onDocsResolved?: (citations: ChatCitation[]) => void
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
    focusDocIds
  );

  const citations: ChatCitation[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    fileName: d.original_file_name,
  }));
  onDocsResolved?.(citations);

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

  return {
    answer,
    citations,
  };
}

export function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "New chat";
  return `${clean.slice(0, 48).trim()}...`;
}
