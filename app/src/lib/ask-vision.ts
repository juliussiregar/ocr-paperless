import OpenAI from "openai";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";
import {
  getPaperlessToken,
  getPaperlessUrl,
  type PaperlessDocument,
} from "./paperless";

const apiKey = process.env.OPENAI_API_KEY;
const visionModel =
  process.env.ASK_VISION_MODEL?.trim() || "gpt-4o-mini";

function visionEnabled(): boolean {
  const raw = process.env.ASK_VISION_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return !!apiKey?.startsWith("sk-");
}

function isImageDoc(doc: PaperlessDocument): boolean {
  const name = (doc.original_file_name ?? "").toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif|tif|tiff)$/i.test(name);
}

function isZrbQuestion(question: string, keywords?: string[]): boolean {
  const hay = `${question} ${keywords?.join(" ") ?? ""}`.toLowerCase();
  return /\b(zrb|zona rawan|peta|peta zona|layer|gis|peta risiko)\b/i.test(hay);
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

async function fetchThumbnailBase64(docId: number): Promise<string | null> {
  const token = getPaperlessToken();
  const url = `${getPaperlessUrl()}/api/documents/${docId}/thumb/`;
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Token ${token}` } : {},
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Admin-only vision pass for image maps (ZRB) when OCR text is weak.
 */
export async function maybeVisionContextForZrb(opts: {
  isAdmin: boolean;
  question: string;
  keywords?: string[];
  doc: PaperlessDocument;
}): Promise<{ context: string; usage?: OpenAiUsageSnapshot } | null> {
  if (!opts.isAdmin || !visionEnabled()) return null;
  if (!isImageDoc(opts.doc) || !isZrbQuestion(opts.question, opts.keywords)) {
    return null;
  }

  const client = getClient();
  if (!client) return null;

  const thumb = await fetchThumbnailBase64(opts.doc.id);
  if (!thumb) return null;

  try {
    const completion = await client.chat.completions.create({
      model: visionModel,
      temperature: 0,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content:
            "Deskripsikan peta/gambar zona rawan bencana atau peta tematik. " +
            "Sebut legenda, warna zona, wilayah geografis yang terlihat. Bahasa Indonesia. " +
            "Jika tidak terbaca, katakan gambar tidak jelas.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Pertanyaan user: ${opts.question}`,
            },
            {
              type: "image_url",
              image_url: { url: thumb, detail: "low" },
            },
          ],
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (text.length < 20) return null;
    const usage = mergeUsage(emptyUsage(visionModel), {
      model: visionModel,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      chatHits: 1,
    });
    return {
      context: `Deskripsi visual peta (admin vision):\n${text}`,
      usage,
    };
  } catch {
    return null;
  }
}
