import OpenAI from "openai";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";

const apiKey = process.env.OPENAI_API_KEY;
const verifyModel =
  process.env.ASK_VERIFY_MODEL?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";

export function answerVerifyEnabled(): boolean {
  const raw = process.env.ASK_VERIFY_ANSWER?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return !!apiKey?.startsWith("sk-");
}

/** Skip verify for list/search; keep for fact/detail/analyze. */
export function shouldVerifyAnswer(intent: string, question: string): boolean {
  if (!answerVerifyEnabled()) return false;
  if (intent === "list") return false;
  if (
    /\b(cari|lihat|temukan|sebutkan|daftar|apa saja|apa aja)\b/i.test(question) &&
    !/\b(berapa|berapa banyak|berapa besar)\b/i.test(question)
  ) {
    return false;
  }
  return true;
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

function verifyContextChars(): number {
  const n = Number(process.env.ASK_VERIFY_CONTEXT_CHARS ?? "40000");
  if (!Number.isFinite(n)) return 40000;
  return Math.min(80000, Math.max(8000, Math.floor(n)));
}

/**
 * Second pass: check answer is supported by context; soften or flag if not.
 */
export async function verifyAnswerAgainstContext(opts: {
  context: string;
  question: string;
  answer: string;
}): Promise<{ answer: string; usage?: OpenAiUsageSnapshot; verified: boolean }> {
  const client = getClient();
  if (!client || !answerVerifyEnabled()) {
    return { answer: opts.answer, verified: true };
  }

  const contextSlice = opts.context.slice(0, verifyContextChars());
  try {
    const completion = await client.chat.completions.create({
      model: verifyModel,
      temperature: 0,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Cek apakah jawaban asisten didukung oleh konteks dokumen. " +
            "Output JSON: {\"supported\":boolean,\"revisedAnswer\":string|null}. " +
            "revisedAnswer: perbaiki atau katakan tidak ditemukan jika unsupported. Bahasa Indonesia.",
        },
        {
          role: "user",
          content: `Konteks:\n${contextSlice}\n\nPertanyaan: ${opts.question}\n\nJawaban asisten:\n${opts.answer}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const data = JSON.parse(raw) as {
      supported?: boolean;
      revisedAnswer?: string | null;
    };
    const usage = mergeUsage(emptyUsage(verifyModel), {
      model: verifyModel,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      chatHits: 1,
    });

    if (data.supported === true) {
      return { answer: opts.answer, usage, verified: true };
    }
    const revised =
      typeof data.revisedAnswer === "string" && data.revisedAnswer.trim()
        ? data.revisedAnswer.trim()
        : `${opts.answer}\n\n(Catatan: beberapa bagian jawaban tidak terdapat eksplisit di cuplikan konteks.)`;
    return { answer: revised, usage, verified: false };
  } catch {
    return { answer: opts.answer, verified: true };
  }
}
