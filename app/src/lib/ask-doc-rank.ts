import type { PaperlessDocument } from "./paperless";
import { cosineSimilarity } from "./embeddings";

export type DocRankScore = {
  docId: number;
  score: number;
  nameScore: number;
  contentScore: number;
  docEmbedScore: number;
  chunkBoost: number;
};

/** Rank candidate docs using stored doc-level embeddings (filename + summary). */
export async function rankDocsByDocEmbedding(
  userId: string,
  docs: PaperlessDocument[],
  queryVec: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (docs.length === 0 || queryVec.length === 0) return out;

  const ids = docs.map((d) => d.id);
  const { prisma } = await import("./prisma");
  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      paperlessDocumentId: { in: ids },
    },
    select: { paperlessDocumentId: true, docEmbedding: true },
  });

  for (const row of rows) {
    const id = row.paperlessDocumentId;
    if (!id) continue;
    const emb = row.docEmbedding;
    if (!Array.isArray(emb) || emb.length === 0) continue;
    const sim = cosineSimilarity(queryVec, emb as number[]);
    out.set(id, sim * 50);
  }
  return out;
}

export async function loadDocSummaries(
  userId: string,
  docIds: number[]
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (docIds.length === 0) return out;
  const { prisma } = await import("./prisma");
  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      paperlessDocumentId: { in: docIds },
    },
    select: { paperlessDocumentId: true, docSummary: true },
  });
  for (const row of rows) {
    const id = row.paperlessDocumentId;
    const s = row.docSummary?.trim();
    if (id && s) out.set(id, s);
  }
  return out;
}
