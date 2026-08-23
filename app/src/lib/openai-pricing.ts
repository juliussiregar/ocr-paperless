/**
 * Rough USD estimates for OpenAI usage (admin dashboard).
 * Override via env if pricing changes.
 *
 * OPENAI_PRICE_CHAT_INPUT_PER_MTok / OPENAI_PRICE_CHAT_OUTPUT_PER_MTok
 * OPENAI_PRICE_EMBED_PER_MTok
 */

function numEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Default: gpt-4o-mini-ish rates (USD per 1M tokens). */
export function chatInputPricePerMTok(): number {
  return numEnv("OPENAI_PRICE_CHAT_INPUT_PER_MTok", 0.15);
}

export function chatOutputPricePerMTok(): number {
  return numEnv("OPENAI_PRICE_CHAT_OUTPUT_PER_MTok", 0.6);
}

/** Default: text-embedding-3-small */
export function embedPricePerMTok(): number {
  return numEnv("OPENAI_PRICE_EMBED_PER_MTok", 0.02);
}

export type OpenAiUsageSnapshot = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  embeddingTokens: number;
  embeddingHits: number;
  chatHits: number;
  estimatedCostUsd: number;
};

export function emptyUsage(model = "unknown"): OpenAiUsageSnapshot {
  return {
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    embeddingTokens: 0,
    embeddingHits: 0,
    chatHits: 0,
    estimatedCostUsd: 0,
  };
}

export function estimateCostUsd(opts: {
  promptTokens?: number;
  completionTokens?: number;
  embeddingTokens?: number;
}): number {
  const pin = (opts.promptTokens ?? 0) / 1_000_000;
  const pout = (opts.completionTokens ?? 0) / 1_000_000;
  const pemb = (opts.embeddingTokens ?? 0) / 1_000_000;
  return (
    pin * chatInputPricePerMTok() +
    pout * chatOutputPricePerMTok() +
    pemb * embedPricePerMTok()
  );
}

export function mergeUsage(
  a: OpenAiUsageSnapshot,
  b: Partial<OpenAiUsageSnapshot>
): OpenAiUsageSnapshot {
  const promptTokens = a.promptTokens + (b.promptTokens ?? 0);
  const completionTokens = a.completionTokens + (b.completionTokens ?? 0);
  const embeddingTokens = a.embeddingTokens + (b.embeddingTokens ?? 0);
  const embeddingHits = a.embeddingHits + (b.embeddingHits ?? 0);
  const chatHits = a.chatHits + (b.chatHits ?? 0);
  const totalTokens =
    promptTokens + completionTokens + embeddingTokens;
  return {
    model: b.model || a.model,
    promptTokens,
    completionTokens,
    totalTokens,
    embeddingTokens,
    embeddingHits,
    chatHits,
    estimatedCostUsd: estimateCostUsd({
      promptTokens,
      completionTokens,
      embeddingTokens,
    }),
  };
}

/** Parse usage fields from audit meta JSON (best-effort). */
export function usageFromAuditMeta(
  meta: Record<string, unknown> | null
): Partial<OpenAiUsageSnapshot> {
  if (!meta) return {};
  const n = (k: string) => {
    const v = meta[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    model: typeof meta.model === "string" ? meta.model : undefined,
    promptTokens: n("promptTokens"),
    completionTokens: n("completionTokens"),
    totalTokens: n("totalTokens"),
    embeddingTokens: n("embeddingTokens"),
    embeddingHits: n("embeddingHits"),
    chatHits: n("chatHits"),
    estimatedCostUsd:
      typeof meta.estimatedCostUsd === "number"
        ? meta.estimatedCostUsd
        : undefined,
  };
}
