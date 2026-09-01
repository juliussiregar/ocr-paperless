import OpenAI from "openai";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";

const apiKey = process.env.OPENAI_API_KEY;
const model =
  process.env.ASK_HYDE_MODEL?.trim() ||
  process.env.ASK_KEYWORD_MODEL?.trim() ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini";

function enabled(): boolean {
  const raw = process.env.ASK_HYDE_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return !!apiKey?.startsWith("sk-");
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

/**
 * HyDE: generate a short hypothetical document passage for embedding search.
 */
export async function generateHydePassage(
  question: string,
  keywords?: string[]
): Promise<{ passage: string; usage?: OpenAiUsageSnapshot } | null> {
  if (!enabled()) return null;
  const client = getClient();
  if (!client) return null;

  const kw = keywords?.length ? `Kata kunci: ${keywords.join(", ")}` : "";
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "Tulis 2-4 kalimat Bahasa Indonesia seperti cuplikan dokumen arsip pemerintah (laporan, undangan, nota dinas) yang kemungkinan menjawab pertanyaan user. " +
            "Hanya teks cuplikan, tanpa judul atau meta.",
        },
        {
          role: "user",
          content: `${kw}\nPertanyaan: ${question}`,
        },
      ],
    });
    const passage = completion.choices[0]?.message?.content?.trim() ?? "";
    if (passage.length < 20) return null;
    const usage = mergeUsage(emptyUsage(model), {
      model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      chatHits: 1,
    });
    return { passage, usage };
  } catch {
    return null;
  }
}
