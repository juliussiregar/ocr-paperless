import OpenAI from "openai";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";

const apiKey = process.env.OPENAI_API_KEY;
const chatModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const keywordModel =
  process.env.ASK_KEYWORD_MODEL?.trim() || chatModel;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function keywordMin(): number {
  return envInt("ASK_SEARCH_KEYWORDS_MIN", 2, 1, 8);
}

function keywordMax(): number {
  const min = keywordMin();
  return envInt("ASK_SEARCH_KEYWORDS_MAX", 5, min, 10);
}

function aiKeywordsEnabled(): boolean {
  const raw = process.env.ASK_AI_SEARCH_KEYWORDS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return !!apiKey?.startsWith("sk-");
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

export type AskPlannerIntent =
  | "list"
  | "fact"
  | "detail"
  | "analyze"
  | "compare"
  | "default";

export type SearchPlan = {
  queries: string[];
  keywords: string[];
  intent?: AskPlannerIntent;
  source: "ai" | "heuristic";
  usage?: OpenAiUsageSnapshot;
};

type HistoryLine = { role: "user" | "assistant"; content: string };

/** Carry keywords/entities from recent turns for follow-up questions. */
export function extractHistoryContext(history: HistoryLine[]): {
  keywords: string[];
  snippet: string;
} {
  const keywords: string[] = [];
  const push = (k: string) => {
    const t = k.replace(/\s+/g, " ").trim();
    if (t.length < 3) return;
    if (!keywords.some((x) => x.toLowerCase() === t.toLowerCase())) {
      keywords.push(t);
    }
  };

  const recent = history.slice(-6);
  for (const m of recent) {
    if (m.role === "user") {
      for (const k of heuristicSearchKeywords(m.content).slice(0, 4)) push(k);
    }
  }

  const snippet = recent
    .map((m) => `${m.role === "user" ? "User" : "Asisten"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  return { keywords: keywords.slice(0, 8), snippet };
}

/** Regex fallback when AI planner is off or fails. */
export function heuristicSearchKeywords(question: string): string[] {
  const cleaned = question
    .replace(
      /\b(saya mau|tolong|mohon|bisa|lihat|cari|ada|sebutkan|daftar|ringkas|jelaskan|uraikan)\b/gi,
      " "
    )
    .replace(
      /\b(dokumen|file|pdf|arsip)?\s*(tentang|mengenai|terkait|soal)\b/gi,
      " "
    )
    .replace(
      /\b(apa saja|apa aja|yang|berapa|kira[- ]?kira|sekitar|perkiraan|mungkin|apakah|bagaimana|mengapa|kenapa|seberapa|\d+|lima|terbaru|terkini|terakhir)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .toLowerCase()
    .split(/[^a-z0-9à-ü]+/i)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length > 2 &&
        !/^(dan|atau|untuk|dari|dengan|pada|tentang|mengenai|cari|lihat|dokumen|file|pdf|apa|saja|aja|tolong|mohon|di|ke|ya|yg)$/i.test(
          w
        )
    );

  const keywords: string[] = [];
  const push = (k: string) => {
    const t = k.replace(/\s+/g, " ").trim();
    if (t.length < 2) return;
    if (!keywords.some((x) => x.toLowerCase() === t.toLowerCase())) {
      keywords.push(t);
    }
  };

  const quoted = question.match(/["“](.+?)["”]/g);
  if (quoted) {
    for (const q of quoted) {
      const inner = q.replace(/^["“]|["”]$/g, "").trim();
      if (inner.length >= 2) push(inner);
    }
  }

  for (const t of tokens) push(t);
  if (tokens.length >= 2) push(tokens.slice(0, 2).join(" "));
  if (tokens.length >= 3) push(tokens.slice(-3).join(" "));

  const max = keywordMax();
  return keywords.slice(0, max);
}

export function buildSearchQueriesFromKeywords(keywords: string[]): string[] {
  const out: string[] = [];
  const push = (q: string) => {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 3) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) {
      out.push(t);
    }
  };

  for (const k of keywords) push(k);
  if (keywords.length >= 2) push(keywords.join(" "));
  if (keywords.length >= 3) push(keywords.slice(0, 3).join(" "));

  return out.slice(0, 5);
}

function pushKeyword(out: string[], k: string, max: number): void {
  const t = k.replace(/\s+/g, " ").trim().slice(0, 60);
  if (t.length < 2) return;
  if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) {
    out.push(t);
  }
  if (out.length > max) out.length = max;
}

function clampKeywords(raw: string[], questionFallback?: string): string[] {
  const min = keywordMin();
  const max = keywordMax();
  const out: string[] = [];
  for (const item of raw) {
    pushKeyword(out, String(item ?? ""), max);
    if (out.length >= max) break;
  }
  if (out.length < min && questionFallback) {
    for (const k of heuristicSearchKeywords(questionFallback)) {
      pushKeyword(out, k, max);
      if (out.length >= min) break;
    }
  }
  return out.slice(0, max);
}

function parsePlannerJson(text: string): {
  keywords: string[];
  intent?: AskPlannerIntent;
} | null {
  try {
    const data = JSON.parse(text) as { keywords?: unknown; intent?: unknown };
    if (!Array.isArray(data.keywords)) return null;
    const keywords = data.keywords.map((k) =>
      typeof k === "string" ? k : String(k)
    );
    let intent: AskPlannerIntent | undefined;
    const rawIntent = typeof data.intent === "string" ? data.intent.toLowerCase() : "";
    if (
      rawIntent === "list" ||
      rawIntent === "fact" ||
      rawIntent === "detail" ||
      rawIntent === "analyze" ||
      rawIntent === "compare" ||
      rawIntent === "default"
    ) {
      intent = rawIntent;
    }
    return { keywords, intent };
  } catch {
    return null;
  }
}

function heuristicIntent(question: string): AskPlannerIntent {
  if (
    /\b(bandingkan|perbandingan|bedakan|persamaan|perbedaan)\b/i.test(question)
  ) {
    return "compare";
  }
  if (
    /\b(cari|lihat|temukan|sebutkan|daftar|apa saja|apa aja|dokumen tentang)\b/i.test(
      question
    ) &&
    !/\b(berapa|berapa banyak|berapa besar)\b/i.test(question)
  ) {
    return "list";
  }
  if (/\b(analisis|evaluasi|dampak|implikasi)\b/i.test(question)) {
    return "analyze";
  }
  if (/\b(berapa|berapa banyak|berapa besar|jumlah|total|statistik)\b/i.test(question)) {
    return "fact";
  }
  if (
    /\b(detail|jelaskan|uraikan|poin penting|keputusan|kesimpulan|apa isi|isinya)\b/i.test(
      question
    )
  ) {
    return "detail";
  }
  return "default";
}

async function planWithAi(
  question: string,
  history: HistoryLine[]
): Promise<{ keywords: string[]; intent?: AskPlannerIntent; usage: OpenAiUsageSnapshot } | null> {
  const client = getClient();
  if (!client || !aiKeywordsEnabled()) return null;

  const min = keywordMin();
  const max = keywordMax();
  const prior = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Asisten"}: ${m.content}`)
    .join("\n");

  const system = `Kamu planner pencarian dokumen arsip pemerintah (PDF, laporan, undangan, Bappenas).
Dari pertanyaan user, ekstrak kata kunci untuk search engine full-text dan tentukan intent.

Aturan:
- Output JSON saja: {"keywords":["..."],"intent":"..."}
- "keywords": minimal ${min}, maksimal ${max} item
- Hanya entitas/topik: lokasi, institusi, program, jenis dokumen, nama kejadian, istilah teknis
- JANGAN di keywords: kata tanya (berapa, apakah, bagaimana), filler (kira-kira, sekitar, tolong), kata umum (dokumen, file)
- Frasa pendek boleh ("aceh timur", "korban bencana")
- "intent" salah satu:
  - list: user minta daftar/cari banyak dokumen
  - fact: user minta angka/jumlah/total/statistik spesifik
  - detail: user minta penjelasan isi satu/topik
  - analyze: analisis mendalam, dampak, implikasi
  - compare: bandingkan dokumen
  - default: ringkas umum
- Bahasa Indonesia; pertahankan istilah resmi
- Pertanyaan lanjutan: gabung konteks riwayat chat`;

  const userParts = [
    prior ? `Riwayat singkat:\n${prior}\n\n` : "",
    `Pertanyaan sekarang: ${question}`,
  ].join("");

  try {
    const completion = await client.chat.completions.create({
      model: keywordModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = parsePlannerJson(text);
    if (!parsed) return null;
    const keywords = clampKeywords(parsed.keywords, question);
    if (keywords.length === 0) return null;

    const promptTokens = completion.usage?.prompt_tokens ?? 0;
    const completionTokens = completion.usage?.completion_tokens ?? 0;
    const usage = mergeUsage(emptyUsage(keywordModel), {
      model: keywordModel,
      promptTokens,
      completionTokens,
      chatHits: 1,
    });

    return { keywords, intent: parsed.intent, usage };
  } catch {
    return null;
  }
}

/** Plan Paperless search queries from user question (AI layer + heuristic fallback). */
export async function planDocumentSearch(
  question: string,
  history: HistoryLine[] = []
): Promise<SearchPlan> {
  const histCtx = extractHistoryContext(history);
  const ai = await planWithAi(question, history);
  if (ai && ai.keywords.length > 0) {
    const mergedKeywords = clampKeywords(
      [...ai.keywords, ...histCtx.keywords],
      question
    );
    const queries = buildSearchQueriesFromKeywords(mergedKeywords);
    if (queries.length > 0) {
      return {
        queries,
        keywords: mergedKeywords,
        intent: ai.intent,
        source: "ai",
        usage: ai.usage,
      };
    }
  }

  const keywords = clampKeywords(
    [...heuristicSearchKeywords(question), ...histCtx.keywords],
    question
  );
  const queries = buildSearchQueriesFromKeywords(keywords);
  if (queries.length === 0 && question.trim().length >= 3) {
    queries.push(question.trim().slice(0, 200));
  }

  return {
    queries,
    keywords,
    intent: heuristicIntent(question),
    source: "heuristic",
  };
}
