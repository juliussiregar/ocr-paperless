import { createHash } from "crypto";
import { prisma } from "./db.js";
import { getPaperlessDocumentContent } from "./paperless.js";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 32;
const BACKFILL_BATCH = Number(process.env.EMBED_BACKFILL_BATCH ?? "5") || 5;

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

async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey.startsWith("sk-") || texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) out.push(row.embedding);
  }
  return out;
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

  await prisma.$transaction(async (tx) => {
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
  });

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

  const embeddings = await embedTexts(parts.map((p) => p.slice(0, 8000)));
  if (embeddings.length !== parts.length) {
    throw new Error("Embedding count mismatch");
  }

  await prisma.$transaction(async (tx) => {
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
          embedding: embeddings[i]!,
          tokenEstimate: estimateTokens(parts[i]!),
          contentHash,
        },
      });
    }
  });

  return { chunks: parts.length };
}

/** Backfill embeddings for OCR_DONE/SKIPPED files missing this user's chunks. */
export async function backfillDocumentEmbeddings(): Promise<number> {
  if (!isConfigured()) return 0;

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
