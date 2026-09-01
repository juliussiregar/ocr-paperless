import type { PaperlessDocument } from "./paperless";
import type { OpenAiUsageSnapshot } from "./openai-pricing";
import {
  prepareAskQueryVector,
  retrieveRelevantChunks,
  type ChunkRetrievalResult,
} from "./ask-retrieval";

function agentLoopEnabled(): boolean {
  const raw = process.env.ASK_AGENT_LOOP?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return false;
}

function maxPasses(): number {
  const n = Number(process.env.ASK_AGENT_MAX_PASSES ?? "2");
  return Number.isFinite(n) ? Math.min(3, Math.max(1, Math.floor(n))) : 2;
}

function retrievalMinScore(): number {
  const n = Number(process.env.ASK_RETRIEVAL_MIN_SCORE ?? "0.28");
  return Number.isFinite(n) ? Math.min(0.9, Math.max(0.1, n)) : 0.28;
}

export type AgentRetrievalOutcome = ChunkRetrievalResult & {
  agentPasses: number;
  rerankUsage?: OpenAiUsageSnapshot;
  hydeUsage?: OpenAiUsageSnapshot;
};

/**
 * Agent loop: retry retrieval with expanded doc pool when initial score is weak.
 */
export async function retrieveWithAgentLoop(opts: {
  userId: string;
  allRankedDocs: PaperlessDocument[];
  activeDocs: PaperlessDocument[];
  question: string;
  keywords?: string[];
  maxChunks?: number;
  chunksPerDoc?: number;
  maxChunkChars?: number;
  docLimit?: number;
}): Promise<AgentRetrievalOutcome> {
  const minScore = retrievalMinScore();
  const limit = opts.docLimit ?? 8;
  let docs = opts.activeDocs;
  let pass = 0;

  const queryBundle = await prepareAskQueryVector(opts.question, opts.keywords);
  const cachedQueryVec = queryBundle.vec;
  const cachedHydeUsage = queryBundle.hydeUsage;

  let last: AgentRetrievalOutcome = {
    byDoc: new Map(),
    docOrder: [],
    embeddingHits: 0,
    embeddingTokens: 0,
    bestScore: 0,
    agentPasses: 0,
  };

  if (!cachedQueryVec) {
    return last;
  }

  while (pass < maxPasses()) {
    pass++;
    const retrieval = await retrieveRelevantChunks({
      userId: opts.userId,
      docs,
      question: opts.question,
      keywords: opts.keywords,
      maxChunks: opts.maxChunks,
      chunksPerDoc: opts.chunksPerDoc,
      maxChunkChars: opts.maxChunkChars,
      docLimit: limit + (pass > 1 ? 6 : 0),
      queryVec: cachedQueryVec,
      hydeUsage: cachedHydeUsage,
    });

    last = {
      ...retrieval,
      agentPasses: pass,
      embeddingHits: queryBundle.embeddingHits,
      embeddingTokens: queryBundle.embeddingTokens,
      rerankUsage: retrieval.rerankUsage,
      hydeUsage: cachedHydeUsage ?? retrieval.hydeUsage,
    };

    if (
      !agentLoopEnabled() ||
      pass >= maxPasses() ||
      retrieval.bestScore >= minScore ||
      opts.allRankedDocs.length <= docs.length
    ) {
      break;
    }

    const expanded = Math.min(opts.allRankedDocs.length, limit + pass * 6);
    docs = opts.allRankedDocs.slice(0, expanded);
  }

  return last;
}

export function shouldExpandAfterVerify(
  verified: boolean,
  bestScore: number
): boolean {
  if (!agentLoopEnabled()) return false;
  if (verified) return false;
  return bestScore < retrievalMinScore();
}
