import { prisma } from "./db.js";

const KEY_EMBED = "ai_lifetime_embedding_tokens";
const KEY_EMBED_HITS = "ai_lifetime_embedding_hits";

function embedPricePerMTok(): number {
  const n = Number(process.env.OPENAI_PRICE_EMBED_PER_MTok ?? "0.02");
  return Number.isFinite(n) && n >= 0 ? n : 0.02;
}

function estimateEmbedCostUsd(embeddingTokens: number): number {
  return (embeddingTokens / 1_000_000) * embedPricePerMTok();
}

async function bumpSetting(key: string, delta: number): Promise<void> {
  if (delta <= 0) return;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const current = Number(row?.value ?? 0);
  const next = (Number.isFinite(current) ? current : 0) + delta;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: String(Math.floor(next)) },
    update: { value: String(Math.floor(next)) },
  });
}

/** Record document embedding API usage for Admin audit + lifetime cost. */
export async function recordDocumentEmbedUsage(opts: {
  userId: string;
  paperlessDocumentId: number;
  syncFileId: string;
  chunks: number;
  embeddingTokens: number;
  model: string;
}): Promise<void> {
  if (opts.embeddingTokens <= 0) return;

  const estimatedCostUsd = estimateEmbedCostUsd(opts.embeddingTokens);
  const meta = {
    model: opts.model,
    promptTokens: 0,
    completionTokens: 0,
    embeddingTokens: opts.embeddingTokens,
    embeddingHits: 1,
    chatHits: 0,
    totalTokens: opts.embeddingTokens,
    estimatedCostUsd,
    chunks: opts.chunks,
    paperlessDocumentId: opts.paperlessDocumentId,
    syncFileId: opts.syncFileId,
    source: "sync_worker_embed",
  };

  try {
    await prisma.auditLog.create({
      data: {
        action: "embed.index",
        userId: opts.userId,
        meta: JSON.stringify(meta),
      },
    });
    await bumpSetting(KEY_EMBED, opts.embeddingTokens);
    await bumpSetting(KEY_EMBED_HITS, 1);
  } catch (err) {
    console.error(
      "[embed-audit]",
      err instanceof Error ? err.message : err
    );
  }
}
