import { createHash } from "crypto";
import { prisma } from "./db.js";
import { getPaperlessDocumentContent } from "./paperless.js";
import { recordDocumentEmbedUsage } from "./embed-audit.js";
import { isHeavySyncActive } from "./sync-busy.js";

const CHUNK_SIZE = envChunkSize();
const CHUNK_OVERLAP = envChunkOverlap();
const EMBED_BATCH = 32;
const BACKFILL_BATCH = Number(process.env.EMBED_BACKFILL_BATCH ?? "15") || 15;
const EMBED_TX_TIMEOUT_MS = Number(process.env.EMBED_TX_TIMEOUT_MS ?? "60000") || 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pauseEmbedDuringSync(): boolean {
  return (process.env.EMBED_PAUSE_DURING_INGEST ?? "true") !== "false";
}

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

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function embeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
}

function isConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY ?? "";
  return key.startsWith("sk-");
}

async function embedTexts(
  texts: string[]
): Promise<{ vectors: number[][]; tokens: number }> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey.startsWith("sk-") || texts.length === 0) {
    return { vectors: [], tokens: 0 };
  }

  const out: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: embeddingModel(),
          input: batch,
        }),
      });

      if (res.status === 429) {
        const waitMs = Math.min(90_000, 8_000 * 2 ** attempt);
        console.warn(
          `[embed] rate limited (429), retry in ${Math.round(waitMs / 1000)}s`
        );
        await sleep(waitMs);
        lastErr = new Error(`Embedding API 429 (attempt ${attempt + 1})`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
        usage?: { prompt_tokens?: number; total_tokens?: number };
      };
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      for (const row of sorted) out.push(row.embedding);
      const usageTokens =
        typeof data.usage?.total_tokens === "number"
          ? data.usage.total_tokens
          : typeof data.usage?.prompt_tokens === "number"
            ? data.usage.prompt_tokens
            : batch.reduce((n, t) => n + estimateTokens(t), 0);
      tokens += usageTokens;
      lastErr = null;
      break;
    }

    if (lastErr) throw lastErr;
  }
  return { vectors: out, tokens };
}

async function cloneChunksFromPeer(opts: {
  userId: string;
  syncFileId: string;
  paperlessDocumentId: number;
}): Promise<number> {
  const peer = await prisma.documentChunk.findFirst({
    where: {
      paperlessDocumentId: opts.paperlessDocumentId,
      NOT: { userId: opts.userId },
    },
    select: { userId: true, contentHash: true },
  });
  if (!peer) return 0;

  const ownFresh = await prisma.documentChunk.findFirst({
    where: {
      userId: opts.userId,
      paperlessDocumentId: opts.paperlessDocumentId,
      contentHash: peer.contentHash,
    },
    select: { id: true },
  });
  if (ownFresh) return 0;

  const peerChunks = await prisma.documentChunk.findMany({
    where: {
      userId: peer.userId,
      paperlessDocumentId: opts.paperlessDocumentId,
      contentHash: peer.contentHash,
    },
    orderBy: { chunkIndex: "asc" },
    take: 200,
  });
  if (peerChunks.length === 0) return 0;

  await prisma.$transaction(
    async (tx) => {
      await tx.documentChunk.deleteMany({
        where: {
          userId: opts.userId,
          paperlessDocumentId: opts.paperlessDocumentId,
        },
      });
      for (const c of peerChunks) {
        await tx.documentChunk.create({
          data: {
            userId: opts.userId,
            syncFileId: opts.syncFileId,
            paperlessDocumentId: opts.paperlessDocumentId,
            chunkIndex: c.chunkIndex,
            content: c.content,
            embedding: c.embedding as object,
            tokenEstimate: c.tokenEstimate,
            contentHash: c.contentHash,
          },
        });
      }
    },
    { timeout: EMBED_TX_TIMEOUT_MS, maxWait: 15_000 }
  );

  return peerChunks.length;
}

/**
 * Fetch OCR text from Paperless, chunk, embed, upsert DocumentChunk rows.
 * Scoped per userId. May clone another user's chunks for the same Paperless doc.
 */
export async function indexDocumentChunks(opts: {
  userId: string;
  syncFileId: string;
  paperlessDocumentId: number;
}): Promise<{ chunks: number; skipped?: string }> {
  if (!isConfigured()) {
    return { chunks: 0, skipped: "no_openai_key" };
  }

  const cloned = await cloneChunksFromPeer(opts);
  if (cloned > 0) {
    return { chunks: cloned, skipped: "cloned" };
  }

  const content = await getPaperlessDocumentContent(opts.paperlessDocumentId);
  if (!content || content.trim().length < 20) {
    return { chunks: 0, skipped: "empty_content" };
  }

  const contentHash = hashText(content);
  const existing = await prisma.documentChunk.findFirst({
    where: {
      userId: opts.userId,
      paperlessDocumentId: opts.paperlessDocumentId,
      contentHash,
    },
    select: { id: true },
  });
  if (existing) {
    return { chunks: 0, skipped: "up_to_date" };
  }

  const parts = chunkText(content);
  if (parts.length === 0) return { chunks: 0, skipped: "empty_chunks" };

  const embedded = await embedTexts(parts.map((p) => p.slice(0, 8000)));
  if (embedded.vectors.length !== parts.length) {
    throw new Error("Embedding count mismatch");
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.documentChunk.deleteMany({
        where: {
          userId: opts.userId,
          paperlessDocumentId: opts.paperlessDocumentId,
        },
      });
      for (let i = 0; i < parts.length; i++) {
        await tx.documentChunk.create({
          data: {
            userId: opts.userId,
            syncFileId: opts.syncFileId,
            paperlessDocumentId: opts.paperlessDocumentId,
            chunkIndex: i,
            content: parts[i]!,
            embedding: embedded.vectors[i]!,
            tokenEstimate: estimateTokens(parts[i]!),
            contentHash,
          },
        });
      }
    },
    { timeout: EMBED_TX_TIMEOUT_MS, maxWait: 15_000 }
  );

  await recordDocumentEmbedUsage({
    userId: opts.userId,
    paperlessDocumentId: opts.paperlessDocumentId,
    syncFileId: opts.syncFileId,
    chunks: parts.length,
    embeddingTokens: embedded.tokens,
    model: embeddingModel(),
  });

  return { chunks: parts.length };
}

/** Backfill embeddings for OCR_DONE/SKIPPED files missing this user's chunks. */
export async function backfillDocumentEmbeddings(): Promise<number> {
  if (!isConfigured()) return 0;
  if (pauseEmbedDuringSync() && (await isHeavySyncActive())) return 0;

  const done = await prisma.syncFile.findMany({
    where: {
      syncStatus: { in: ["OCR_DONE", "SKIPPED"] },
      paperlessDocumentId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      paperlessDocumentId: true,
    },
    orderBy: { updatedAt: "desc" },
    take: BACKFILL_BATCH * 4,
  });

  let indexed = 0;
  for (const file of done) {
    if (indexed >= BACKFILL_BATCH) break;
    const docId = file.paperlessDocumentId;
    if (!docId) continue;

    const has = await prisma.documentChunk.findFirst({
      where: {
        userId: file.userId,
        paperlessDocumentId: docId,
      },
      select: { id: true },
    });
    if (has) continue;

    try {
      const result = await indexDocumentChunks({
        userId: file.userId,
        syncFileId: file.id,
        paperlessDocumentId: docId,
      });
      if (result.chunks > 0) {
        indexed++;
        console.log(
          `[embed] backfill user=${file.userId} doc=${docId} chunks=${result.chunks}`
        );
      }
    } catch (err) {
      console.error(
        `[embed] backfill failed doc=${docId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return indexed;
}
