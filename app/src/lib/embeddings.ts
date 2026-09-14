import { createHash } from "crypto";
import OpenAI from "openai";
import { ASK_EMBED_NOT_CONFIGURED } from "./product-copy";

const CHUNK_SIZE = envChunkSize();
const CHUNK_OVERLAP = envChunkOverlap();
const EMBED_BATCH = 64;

function envChunkSize(): number {
  const n = Number(process.env.ASK_CHUNK_SIZE ?? "1500");
  return Number.isFinite(n) && n >= 500 ? Math.min(4000, Math.floor(n)) : 1500;
}

function envChunkOverlap(): number {
  const n = Number(process.env.ASK_CHUNK_OVERLAP ?? "200");
  return Number.isFinite(n) && n >= 0 ? Math.min(800, Math.floor(n)) : 200;
}

export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + size);
    chunks.push(cleaned.slice(start, end));
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.startsWith("sk-")) return null;
  return new OpenAI({ apiKey });
}

export function getEmbeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
}

export function isEmbeddingConfigured(): boolean {
  return !!getClient();
}

/** Batch-embed texts; returns one vector per input (same order). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const client = getClient();
  if (!client) {
    throw new Error(ASK_EMBED_NOT_CONFIGURED);
  }
  if (texts.length === 0) return [];

  const model = getEmbeddingModel();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await client.embeddings.create({ model, input: batch });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) {
      out.push(row.embedding);
    }
  }
  return out;
}

export async function embedQuery(question: string): Promise<number[] | null> {
  if (!isEmbeddingConfigured()) return null;
  const q = question.trim();
  if (!q) return null;
  try {
    const [vec] = await embedTexts([q.slice(0, 8000)]);
    return vec ?? null;
  } catch {
    return null;
  }
}
