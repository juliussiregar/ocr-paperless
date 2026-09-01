import type { PaperlessDocument } from "./paperless";
import type { OpenAiUsageSnapshot } from "./openai-pricing";
import {
  cosineSimilarity,
  embedQuery,
  estimateTokens,
  isEmbeddingConfigured,
} from "./embeddings";
import { generateHydePassage } from "./ask-hyde";
import { rerankRetrievedChunks } from "./ask-rerank";
import { isPgvectorAvailable, vectorLiteral } from "./pgvector";

export type RetrievedChunk = {
  paperlessDocumentId: number;
  content: string;
  chunkIndex: number;
  pageEstimate: number | null;
  score: number;
};

export type ChunkRetrievalResult = {
  byDoc: Map<number, RetrievedChunk[]>;
  docOrder: number[];
  embeddingHits: number;
  embeddingTokens: number;
  bestScore: number;
  rerankUsage?: OpenAiUsageSnapshot;
  hydeUsage?: OpenAiUsageSnapshot;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? String(fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function chunkDocLimit(): number {
  return envInt("ASK_CHUNK_DOC_LIMIT", 8, 2, 20);
}

function maxChunkRows(): number {
  return envInt("ASK_CHUNK_ROW_LIMIT", 2500, 500, 8000);
}

function retrievalMinScore(): number {
  const n = Number(process.env.ASK_RETRIEVAL_MIN_SCORE ?? "0.28");
  return Number.isFinite(n) ? Math.min(0.9, Math.max(0.1, n)) : 0.28;
}

function agentSecondPassEnabled(): boolean {
  const raw = process.env.ASK_AGENT_SECOND_PASS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function pgvectorTopK(): number {
  return envInt("ASK_PGVECTOR_TOP_K", 80, 20, 200);
}

function formatSnippet(chunk: RetrievedChunk, maxChars: number): string {
  const page =
    chunk.pageEstimate != null && chunk.pageEstimate > 0
      ? ` (hal. ~${chunk.pageEstimate})`
      : "";
  const body = chunk.content.slice(0, maxChars);
  return `${body}${page}`;
}

async function buildQueryVector(
  question: string,
  keywords?: string[]
): Promise<{
  vec: number[] | null;
  embeddingHits: number;
  embeddingTokens: number;
  hydeUsage?: OpenAiUsageSnapshot;
}> {
  let hydeUsage: OpenAiUsageSnapshot | undefined;

  const baseText = [question, keywords?.join(" ") ?? ""]
    .join(" ")
    .trim()
    .slice(0, 8000);

  const hyde = await generateHydePassage(question, keywords);
  if (hyde?.usage) hydeUsage = hyde.usage;

  const embedText = hyde?.passage
    ? `${baseText}\n\n${hyde.passage}`.slice(0, 8000)
    : baseText;

  const queryVec = await embedQuery(embedText);
  if (!queryVec) {
    return { vec: null, embeddingHits: 0, embeddingTokens: 0, hydeUsage };
  }

  return {
    vec: queryVec,
    embeddingHits: 1,
    embeddingTokens: estimateTokens(embedText),
    hydeUsage,
  };
}

async function fetchChunksPgvector(
  userId: string,
  docIds: number[],
  queryVec: number[],
  limit: number
): Promise<RetrievedChunk[]> {
  if (docIds.length === 0) return [];
  const safeIds = docIds.filter((id) => Number.isInteger(id) && id > 0);
  if (safeIds.length === 0) return [];
  const { prisma } = await import("./prisma");
  const vec = vectorLiteral(queryVec);
  const idList = safeIds.join(",");
  const sql = `
    SELECT paperless_document_id, content, chunk_index, page_estimate,
      1 - (embedding_vec <=> '${vec}'::vector) AS score
    FROM document_chunks
    WHERE user_id = $1
      AND paperless_document_id IN (${idList})
      AND embedding_vec IS NOT NULL
    ORDER BY embedding_vec <=> '${vec}'::vector
    LIMIT $2
  `;
  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        paperless_document_id: number;
        content: string;
        chunk_index: number;
        page_estimate: number | null;
        score: number;
      }>
    >(sql, userId, limit);
    return rows.map((r) => ({
      paperlessDocumentId: r.paperless_document_id,
      content: r.content,
      chunkIndex: r.chunk_index,
      pageEstimate: r.page_estimate,
      score: Number(r.score) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Two-stage retrieval: rank docs first (caller), then vector-search chunks only
 * within top-N documents (pgvector when available, else cosine in JS).
 */
export async function prepareAskQueryVector(
  question: string,
  keywords?: string[]
): Promise<{
  vec: number[] | null;
  embeddingHits: number;
  embeddingTokens: number;
  hydeUsage?: OpenAiUsageSnapshot;
}> {
  return buildQueryVector(question, keywords);
}

export async function retrieveRelevantChunks(opts: {
  userId: string;
  docs: PaperlessDocument[];
  question: string;
  keywords?: string[];
  maxChunks?: number;
  chunksPerDoc?: number;
  maxChunkChars?: number;
  docLimit?: number;
  queryVec?: number[];
  hydeUsage?: OpenAiUsageSnapshot;
}): Promise<ChunkRetrievalResult> {
  const empty: ChunkRetrievalResult = {
    byDoc: new Map(),
    docOrder: [],
    embeddingHits: 0,
    embeddingTokens: 0,
    bestScore: 0,
  };

  if (!opts.userId || !isEmbeddingConfigured() || opts.docs.length === 0) {
    return empty;
  }

  const docLimit = opts.docLimit ?? chunkDocLimit();
  const maxChunks = opts.maxChunks ?? 12;
  const chunksPerDoc = opts.chunksPerDoc ?? 3;
  const minScore = retrievalMinScore();

  const stageDocs = opts.docs.slice(0, docLimit);
  const expandedDocLimit =
    agentSecondPassEnabled() &&
    opts.docs.length > docLimit
      ? Math.min(opts.docs.length, docLimit + 6)
      : docLimit;
  const stageDocIds = opts.docs.slice(0, expandedDocLimit).map((d) => d.id);

  const { vec: queryVec, embeddingHits, embeddingTokens, hydeUsage } =
    opts.queryVec
      ? {
          vec: opts.queryVec,
          embeddingHits: 0,
          embeddingTokens: 0,
          hydeUsage: opts.hydeUsage,
        }
      : await buildQueryVector(opts.question, opts.keywords);
  if (!queryVec) return empty;

  const usePg = await isPgvectorAvailable();
  let topRanked: RetrievedChunk[] = [];

  if (usePg) {
    topRanked = await fetchChunksPgvector(
      opts.userId,
      stageDocIds,
      queryVec,
      pgvectorTopK()
    );
  }

  const { prisma } = await import("./prisma");
  const perDocCap = Math.min(
    400,
    Math.max(80, Math.floor(maxChunkRows() / Math.max(1, stageDocIds.length)))
  );

  let rows: Array<{
    paperlessDocumentId: number;
    content: string;
    embedding: unknown;
    chunkIndex: number;
    pageEstimate: number | null;
  }> = [];

  if (topRanked.length === 0) {
    for (const docId of stageDocIds) {
      const docRows = await prisma.documentChunk.findMany({
        where: { userId: opts.userId, paperlessDocumentId: docId },
        select: {
          paperlessDocumentId: true,
          content: true,
          embedding: true,
          chunkIndex: true,
          pageEstimate: true,
        },
        orderBy: { chunkIndex: "asc" },
        take: perDocCap,
      });
      rows.push(...docRows);
    }
  }

  const rankRowsJs = (limitDocs: number, rowLimit: number) => {
    const limitedDocIds = stageDocs.slice(0, limitDocs).map((d) => d.id);
    const pool = rows.filter((r) => limitedDocIds.includes(r.paperlessDocumentId));
    const ranked: RetrievedChunk[] = [];
    for (const row of pool) {
      const emb = row.embedding;
      if (!Array.isArray(emb) || emb.length === 0) continue;
      ranked.push({
        paperlessDocumentId: row.paperlessDocumentId,
        content: row.content,
        chunkIndex: row.chunkIndex,
        pageEstimate: row.pageEstimate,
        score: cosineSimilarity(queryVec, emb as number[]),
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, rowLimit);
  };

  if (topRanked.length === 0 && rows.length > 0) {
    topRanked = rankRowsJs(docLimit, maxChunks * 2);
  }

  let bestScore = topRanked[0]?.score ?? 0;

  if (
    agentSecondPassEnabled() &&
    bestScore < minScore &&
    opts.docs.length > docLimit &&
    !usePg
  ) {
    const extraIds = opts.docs
      .slice(docLimit, docLimit + 6)
      .map((d) => d.id)
      .filter((id) => !stageDocIds.includes(id));
    if (extraIds.length > 0) {
      for (const docId of extraIds) {
        const extraRows = await prisma.documentChunk.findMany({
          where: {
            userId: opts.userId,
            paperlessDocumentId: docId,
          },
          select: {
            paperlessDocumentId: true,
            content: true,
            embedding: true,
            chunkIndex: true,
            pageEstimate: true,
          },
          orderBy: { chunkIndex: "asc" },
          take: perDocCap,
        });
        rows.push(...extraRows);
      }
      topRanked = rankRowsJs(docLimit + 6, maxChunks * 3);
      bestScore = topRanked[0]?.score ?? bestScore;
    }
  }

  if (
    agentSecondPassEnabled() &&
    bestScore < minScore &&
    opts.docs.length > docLimit &&
    usePg
  ) {
    const extraIds = opts.docs.slice(docLimit, docLimit + 6).map((d) => d.id);
    const extra = await fetchChunksPgvector(
      opts.userId,
      extraIds,
      queryVec,
      pgvectorTopK()
    );
    if (extra.length > 0) {
      topRanked = [...topRanked, ...extra]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxChunks * 3);
      bestScore = topRanked[0]?.score ?? bestScore;
    }
  }

  const reranked = await rerankRetrievedChunks(opts.question, topRanked);
  topRanked = reranked.chunks;
  const rerankUsage = reranked.usage;

  const byDoc = new Map<number, RetrievedChunk[]>();
  const docOrder: number[] = [];
  const docBestScore = new Map<number, number>();
  const pickedKeys = new Set<string>();

  const rowByDocIdx = new Map<
    string,
    { content: string; chunkIndex: number; pageEstimate: number | null }
  >();
  if (rows.length > 0) {
    for (const row of rows) {
      rowByDocIdx.set(`${row.paperlessDocumentId}:${row.chunkIndex}`, {
        content: row.content,
        chunkIndex: row.chunkIndex,
        pageEstimate: row.pageEstimate,
      });
    }
  } else if (usePg && topRanked.length > 0) {
    for (const c of topRanked) {
      rowByDocIdx.set(`${c.paperlessDocumentId}:${c.chunkIndex}`, {
        content: c.content,
        chunkIndex: c.chunkIndex,
        pageEstimate: c.pageEstimate,
      });
    }
  }

  const pick = (chunk: RetrievedChunk) => {
    const key = `${chunk.paperlessDocumentId}:${chunk.chunkIndex}`;
    if (pickedKeys.has(key)) return;
    const bag = byDoc.get(chunk.paperlessDocumentId) ?? [];
    if (bag.length >= chunksPerDoc) return;
    pickedKeys.add(key);
    if (!byDoc.has(chunk.paperlessDocumentId)) {
      byDoc.set(chunk.paperlessDocumentId, bag);
      docOrder.push(chunk.paperlessDocumentId);
    }
    bag.push(chunk);
    const prev = docBestScore.get(chunk.paperlessDocumentId) ?? -1;
    if (chunk.score > prev) docBestScore.set(chunk.paperlessDocumentId, chunk.score);
  };

  for (const c of topRanked.slice(0, maxChunks)) {
    pick(c);
    for (const neighbor of [-1, 1]) {
      const adj = rowByDocIdx.get(`${c.paperlessDocumentId}:${c.chunkIndex + neighbor}`);
      if (adj) {
        pick({
          paperlessDocumentId: c.paperlessDocumentId,
          content: adj.content,
          chunkIndex: adj.chunkIndex,
          pageEstimate: adj.pageEstimate,
          score: c.score * 0.95,
        });
      }
    }
  }

  docOrder.sort(
    (a, b) => (docBestScore.get(b) ?? 0) - (docBestScore.get(a) ?? 0)
  );

  return {
    byDoc,
    docOrder,
    embeddingHits: opts.queryVec ? 0 : embeddingHits,
    embeddingTokens: opts.queryVec ? 0 : embeddingTokens,
    bestScore:
      docBestScore.size > 0 ? Math.max(...docBestScore.values()) : bestScore,
    rerankUsage,
    hydeUsage: opts.hydeUsage ?? hydeUsage,
  };
}

export function formatRetrievedSnippets(
  chunks: RetrievedChunk[],
  maxChunkChars: number
): string {
  return chunks.map((c) => formatSnippet(c, maxChunkChars)).join("\n\n…\n\n");
}

/** Quick best chunk score per doc for ranking boost. */
export async function bestChunkScoreForDocs(
  userId: string,
  docIds: number[],
  question: string,
  keywords?: string[],
  queryVec?: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!userId || docIds.length === 0 || !isEmbeddingConfigured()) return out;

  let vec = queryVec;
  if (!vec) {
    const built = await buildQueryVector(question, keywords);
    vec = built.vec ?? undefined;
  }
  if (!vec) return out;

  const usePg = await isPgvectorAvailable();
  if (usePg) {
    const hits = await fetchChunksPgvector(userId, docIds, vec, docIds.length * 2);
    for (const h of hits) {
      const prev = out.get(h.paperlessDocumentId) ?? 0;
      if (h.score > prev) out.set(h.paperlessDocumentId, h.score);
    }
    return out;
  }

  const { prisma } = await import("./prisma");
  for (const docId of docIds.slice(0, 25)) {
    const chunks = await prisma.documentChunk.findMany({
      where: { userId, paperlessDocumentId: docId },
      select: { embedding: true },
      take: 40,
    });
    let best = 0;
    for (const c of chunks) {
      if (!Array.isArray(c.embedding)) continue;
      const s = cosineSimilarity(vec, c.embedding as number[]);
      if (s > best) best = s;
    }
    if (best > 0) out.set(docId, best);
  }
  return out;
}
