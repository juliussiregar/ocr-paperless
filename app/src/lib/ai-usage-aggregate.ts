import { prisma } from "@/lib/prisma";
import {
  estimateCostUsd,
  usageFromAuditMeta,
  type OpenAiUsageSnapshot,
} from "@/lib/openai-pricing";

const KEY_PROMPT = "ai_lifetime_prompt_tokens";
const KEY_COMPLETION = "ai_lifetime_completion_tokens";
const KEY_EMBED = "ai_lifetime_embedding_tokens";
const KEY_CHAT_EVENTS = "ai_lifetime_chat_events";
const KEY_EMBED_HITS = "ai_lifetime_embedding_hits";
const KEY_BACKFILLED = "ai_lifetime_backfilled_v1";

const AI_AUDIT_ACTIONS = new Set([
  "chat.ask",
  "chat.whatsapp",
  "embed.index",
]);

function parseIntSetting(value: string | undefined | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function readLifetimeCounters(): Promise<{
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  chatEvents: number;
  embeddingHits: number;
}> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          KEY_PROMPT,
          KEY_COMPLETION,
          KEY_EMBED,
          KEY_CHAT_EVENTS,
          KEY_EMBED_HITS,
        ],
      },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    promptTokens: parseIntSetting(map.get(KEY_PROMPT)),
    completionTokens: parseIntSetting(map.get(KEY_COMPLETION)),
    embeddingTokens: parseIntSetting(map.get(KEY_EMBED)),
    chatEvents: parseIntSetting(map.get(KEY_CHAT_EVENTS)),
    embeddingHits: parseIntSetting(map.get(KEY_EMBED_HITS)),
  };
}

async function writeLifetimeCounters(counters: {
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  chatEvents: number;
  embeddingHits: number;
}): Promise<void> {
  const pairs: Array<[string, string]> = [
    [KEY_PROMPT, String(counters.promptTokens)],
    [KEY_COMPLETION, String(counters.completionTokens)],
    [KEY_EMBED, String(counters.embeddingTokens)],
    [KEY_CHAT_EVENTS, String(counters.chatEvents)],
    [KEY_EMBED_HITS, String(counters.embeddingHits)],
  ];
  for (const [key, value] of pairs) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

export type AiUsageSummary = {
  hits: number;
  events: number;
  embeddingHits: number;
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

function summaryFromParts(
  promptTokens: number,
  completionTokens: number,
  embeddingTokens: number,
  chatEvents: number,
  embeddingHits: number
): AiUsageSummary {
  const hits =
    chatEvents > 0
      ? chatEvents
      : promptTokens > 0 || completionTokens > 0
        ? 1
        : 0;
  return {
    hits,
    events: chatEvents,
    embeddingHits,
    promptTokens,
    completionTokens,
    embeddingTokens,
    totalTokens: promptTokens + completionTokens + embeddingTokens,
    estimatedCostUsd: estimateCostUsd({
      promptTokens,
      completionTokens,
      embeddingTokens,
    }),
  };
}

export async function getLifetimeAiUsage(): Promise<AiUsageSummary> {
  await backfillLifetimeFromAuditIfNeeded();
  const c = await readLifetimeCounters();
  return summaryFromParts(
    c.promptTokens,
    c.completionTokens,
    c.embeddingTokens,
    c.chatEvents,
    c.embeddingHits
  );
}

/** Persist running totals (survives range filter and page reload). */
export async function incrementAiUsageFromMeta(
  meta: Record<string, unknown> | undefined
): Promise<void> {
  if (!meta) return;
  const u = usageFromAuditMeta(meta);
  const prompt = u.promptTokens ?? 0;
  const completion = u.completionTokens ?? 0;
  const embedTok = u.embeddingTokens ?? 0;
  const embedHits = u.embeddingHits ?? 0;
  const chatHits = u.chatHits ?? 0;
  const chatEvents =
    chatHits > 0 ? chatHits : prompt > 0 || completion > 0 ? 1 : 0;

  if (
    prompt === 0 &&
    completion === 0 &&
    embedTok === 0 &&
    chatEvents === 0 &&
    embedHits === 0
  ) {
    return;
  }

  const c = await readLifetimeCounters();
  await writeLifetimeCounters({
    promptTokens: c.promptTokens + prompt,
    completionTokens: c.completionTokens + completion,
    embeddingTokens: c.embeddingTokens + embedTok,
    chatEvents: c.chatEvents + chatEvents,
    embeddingHits: c.embeddingHits + embedHits,
  });
}

type SqlAggRow = {
  events: number;
  prompt_tokens: number;
  completion_tokens: number;
  embedding_tokens: number;
  embedding_hits: number;
};

/** Accurate period totals from audit_logs (no row cap). */
export async function aggregateAiUsageSince(since: Date): Promise<AiUsageSummary> {
  const rows = await prisma.$queryRaw<SqlAggRow[]>`
    SELECT
      COUNT(*)::int AS events,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'promptTokens')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS prompt_tokens,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'completionTokens')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS completion_tokens,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'embeddingTokens')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS embedding_tokens,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'embeddingHits')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS embedding_hits
    FROM audit_logs
    WHERE created_at >= ${since}
      AND action IN ('chat.ask', 'chat.whatsapp', 'embed.index')
  `;

  const row = rows[0];
  if (!row) {
    return summaryFromParts(0, 0, 0, 0, 0);
  }

  return summaryFromParts(
    row.prompt_tokens,
    row.completion_tokens,
    row.embedding_tokens,
    row.events,
    row.embedding_hits
  );
}

/** One-time rebuild of lifetime counters from full audit history. */
export async function backfillLifetimeFromAuditIfNeeded(): Promise<void> {
  const flag = await prisma.appSetting.findUnique({
    where: { key: KEY_BACKFILLED },
  });
  if (flag?.value === "true") return;

  const rows = await prisma.$queryRaw<SqlAggRow[]>`
    SELECT
      COUNT(*)::int AS events,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'promptTokens')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS prompt_tokens,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'completionTokens')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS completion_tokens,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'embeddingTokens')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS embedding_tokens,
      COALESCE(SUM(
        CASE
          WHEN meta IS NOT NULL AND meta LIKE '{%'
          THEN COALESCE((meta::jsonb->>'embeddingHits')::numeric, 0)
          ELSE 0
        END
      ), 0)::int AS embedding_hits
    FROM audit_logs
    WHERE action IN ('chat.ask', 'chat.whatsapp', 'embed.index')
  `;

  const row = rows[0];
  if (row) {
    await writeLifetimeCounters({
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      embeddingTokens: row.embedding_tokens,
      chatEvents: row.events,
      embeddingHits: row.embedding_hits,
    });
  }

  await prisma.appSetting.upsert({
    where: { key: KEY_BACKFILLED },
    create: { key: KEY_BACKFILLED, value: "true" },
    update: { value: "true" },
  });
}

export function isAiAuditAction(action: string): boolean {
  return AI_AUDIT_ACTIONS.has(action);
}

export function usageSnapshotFromMeta(
  meta: Record<string, unknown> | undefined
): OpenAiUsageSnapshot | null {
  if (!meta) return null;
  const u = usageFromAuditMeta(meta);
  if (
    (u.promptTokens ?? 0) === 0 &&
    (u.completionTokens ?? 0) === 0 &&
    (u.embeddingTokens ?? 0) === 0
  ) {
    return null;
  }
  return {
    model: u.model ?? "unknown",
    promptTokens: u.promptTokens ?? 0,
    completionTokens: u.completionTokens ?? 0,
    embeddingTokens: u.embeddingTokens ?? 0,
    embeddingHits: u.embeddingHits ?? 0,
    chatHits: u.chatHits ?? 0,
    totalTokens:
      (u.promptTokens ?? 0) +
      (u.completionTokens ?? 0) +
      (u.embeddingTokens ?? 0),
    estimatedCostUsd:
      typeof u.estimatedCostUsd === "number"
        ? u.estimatedCostUsd
        : estimateCostUsd({
            promptTokens: u.promptTokens,
            completionTokens: u.completionTokens,
            embeddingTokens: u.embeddingTokens,
          }),
  };
}
