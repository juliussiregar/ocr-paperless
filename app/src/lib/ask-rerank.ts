import OpenAI from "openai";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";
import type { RetrievedChunk } from "./ask-retrieval";

const apiKey = process.env.OPENAI_API_KEY;
const model =
  process.env.ASK_RERANK_MODEL?.trim() ||
  process.env.ASK_KEYWORD_MODEL?.trim() ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini";

function enabled(): boolean {
  const raw = process.env.ASK_RERANK_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return !!apiKey?.startsWith("sk-");
}

function rerankPool(): number {
  const n = Number(process.env.ASK_RERANK_POOL ?? "30");
  return Number.isFinite(n) ? Math.min(40, Math.max(8, Math.floor(n))) : 30;
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

/** LLM rerank top vector hits for better chunk ordering. */
export async function rerankRetrievedChunks(
  question: string,
  chunks: RetrievedChunk[]
): Promise<{ chunks: RetrievedChunk[]; usage?: OpenAiUsageSnapshot }> {
  if (!enabled() || chunks.length <= 4) {
    return { chunks };
  }
  const client = getClient();
  if (!client) return { chunks };

  const pool = chunks.slice(0, rerankPool());
  const lines = pool.map(
    (c, i) =>
      `[${i}] doc=${c.paperlessDocumentId} hal~${c.pageEstimate ?? "?"}: ${c.content.slice(0, 400)}`
  );

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Urutkan cuplikan dokumen paling relevan untuk pertanyaan. " +
            "Output JSON: {\"order\":[indeks numerik dari input, max 12 item]}",
        },
        {
          role: "user",
          content: `Pertanyaan: ${question}\n\nCuplikan:\n${lines.join("\n\n")}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const data = JSON.parse(raw) as { order?: number[] };
    const order = Array.isArray(data.order) ? data.order : [];
    const picked: RetrievedChunk[] = [];
    const seen = new Set<number>();
    for (const idx of order) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= pool.length) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      picked.push(pool[idx]!);
    }
    const usage = mergeUsage(emptyUsage(model), {
      model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      chatHits: 1,
    });
    if (picked.length === 0) return { chunks };
    for (const c of pool) {
      const idx = pool.indexOf(c);
      if (!seen.has(idx)) picked.push(c);
    }
    return { chunks: picked, usage };
  } catch {
    return { chunks };
  }
}
