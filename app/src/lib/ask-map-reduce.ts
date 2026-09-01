import OpenAI from "openai";
import type { PaperlessDocument } from "./paperless";
import { chunkText } from "./embeddings";
import {
  emptyUsage,
  mergeUsage,
  type OpenAiUsageSnapshot,
} from "./openai-pricing";

const apiKey = process.env.OPENAI_API_KEY;
const mapModel = process.env.ASK_MAP_MODEL?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function mapReduceEnabled(): boolean {
  const raw = process.env.ASK_MAP_REDUCE_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return !!apiKey?.startsWith("sk-");
}

export function mapReduceMinChars(): number {
  return envInt("ASK_MAP_REDUCE_MIN_CHARS", 80000, 20000, 500000);
}

export function mapBatchChars(): number {
  return envInt("ASK_MAP_BATCH_CHARS", 32000, 8000, 80000);
}

function getClient(): OpenAI | null {
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

async function loadOrderedChunkTexts(
  doc: PaperlessDocument,
  userId: string
): Promise<string[]> {
  try {
    const { prisma } = await import("./prisma");
    const rows = await prisma.documentChunk.findMany({
      where: { userId, paperlessDocumentId: doc.id },
      orderBy: { chunkIndex: "asc" },
      select: { content: true, pageEstimate: true },
    });
    if (rows.length > 0) {
      return rows.map((r) => {
        const page =
          r.pageEstimate != null && r.pageEstimate > 0
            ? `[hal. ~${r.pageEstimate}] `
            : "";
        return page + r.content;
      });
    }
  } catch {
    // fallback
  }
  const raw = (doc.content ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  return chunkText(raw, mapBatchChars(), 400);
}

function batchTexts(parts: string[], batchChars: number): string[] {
  const batches: string[] = [];
  let current = "";
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    if (current.length + piece.length + 2 <= batchChars) {
      current = current ? `${current}\n\n${piece}` : piece;
      continue;
    }
    if (current) batches.push(current);
    if (piece.length <= batchChars) {
      current = piece;
    } else {
      let start = 0;
      while (start < piece.length) {
        batches.push(piece.slice(start, start + batchChars));
        start += batchChars;
      }
      current = "";
    }
  }
  if (current) batches.push(current);
  return batches;
}

async function mapBatch(
  client: OpenAI,
  question: string,
  batchText: string,
  batchIndex: number,
  batchTotal: number
): Promise<{ text: string; usage: OpenAiUsageSnapshot }> {
  const completion = await client.chat.completions.create({
    model: mapModel,
    temperature: 0,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content:
          "Ekstrak fakta dari cuplikan OCR untuk membantu jawab pertanyaan user. " +
          "Pertahankan angka, tanggal, nama pihak, lokasi, keputusan. " +
          "Jangan mengarang. Jika tidak ada fakta relevan, jawab satu baris: TIDAK RELEVAN.",
      },
      {
        role: "user",
        content: `Pertanyaan user: ${question}\n\nBagian ${batchIndex + 1}/${batchTotal}:\n${batchText}`,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? "TIDAK RELEVAN";
  const usage = mergeUsage(emptyUsage(mapModel), {
    model: mapModel,
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
    chatHits: 1,
  });
  return { text, usage };
}

async function reduceSummaries(
  client: OpenAI,
  question: string,
  sections: string[]
): Promise<{ text: string; usage: OpenAiUsageSnapshot }> {
  const joined = sections.join("\n\n---\n\n");
  const completion = await client.chat.completions.create({
    model: mapModel,
    temperature: 0,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content:
          "Gabungkan catatan fakta per bagian menjadi satu ringkasan berstruktur untuk pertanyaan user. " +
          "Pertahankan semua angka dan kutipan penting. Hapus duplikat. Bahasa Indonesia.",
      },
      {
        role: "user",
        content: `Pertanyaan: ${question}\n\nCatatan per bagian:\n${joined}`,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? joined;
  const usage = mergeUsage(emptyUsage(mapModel), {
    model: mapModel,
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
    chatHits: 1,
  });
  return { text, usage };
}

export function shouldMapReduce(textLength: number): boolean {
  return mapReduceEnabled() && textLength > mapReduceMinChars();
}

/**
 * Map-reduce OCR for very long documents: map each batch, optional reduce.
 */
export async function mapReduceDocumentBody(opts: {
  doc: PaperlessDocument;
  userId: string;
  question: string;
}): Promise<{ body: string; usage: OpenAiUsageSnapshot }> {
  const client = getClient();
  if (!client) {
    return { body: "", usage: emptyUsage(mapModel) };
  }

  const parts = await loadOrderedChunkTexts(opts.doc, opts.userId);
  const fullLen = parts.join("\n\n").length;
  if (fullLen === 0) {
    return { body: "", usage: emptyUsage(mapModel) };
  }
  if (!shouldMapReduce(fullLen)) {
    return {
      body: parts.join("\n\n").slice(0, mapReduceMinChars() + 20000),
      usage: emptyUsage(mapModel),
    };
  }

  const batches = batchTexts(parts, mapBatchChars());
  let usage = emptyUsage(mapModel);
  const mapped: string[] = [];

  const concurrency = 3;
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map((batch, j) =>
        mapBatch(client, opts.question, batch, i + j, batches.length)
      )
    );
    for (const r of results) {
      usage = mergeUsage(usage, r.usage);
      if (r.text && !/^tidak relevan$/i.test(r.text)) {
        mapped.push(`[Bagian ${mapped.length + 1}]\n${r.text}`);
      }
    }
  }

  if (mapped.length === 0) {
    return {
      body: "(Tidak ada cuplikan relevan ditemukan saat memetakan dokumen panjang.)",
      usage,
    };
  }

  let body = mapped.join("\n\n---\n\n");
  if (body.length > 55000) {
    const reduced = await reduceSummaries(client, opts.question, mapped);
    usage = mergeUsage(usage, reduced.usage);
    body = reduced.text;
  }

  return {
    body:
      body +
      "\n\n[Catatan: dokumen sangat panjang. Konteks ini ringkasan map-reduce dari OCR, bukan teks utuh.]",
    usage,
  };
}
