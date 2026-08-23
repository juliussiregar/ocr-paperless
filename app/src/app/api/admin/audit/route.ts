import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  estimateCostUsd,
  usageFromAuditMeta,
} from "@/lib/openai-pricing";
import { describeAuditAction, isErrorAction } from "@/lib/audit-labels";

export type AuditRange = "today" | "7d" | "30d" | "90d";

function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rangeToSince(range: AuditRange): Date {
  const now = new Date();
  if (range === "today") return startOfLocalDay(now);
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function metaSummary(
  action: string,
  meta: Record<string, unknown> | null
): string {
  if (!meta) return "";
  if (typeof meta.question === "string" && meta.question) {
    return String(meta.question);
  }
  if (typeof meta.q === "string" && meta.q) {
    return `"${meta.q}"`;
  }
  if (typeof meta.error === "string" && meta.error) {
    return String(meta.error);
  }
  if (typeof meta.email === "string") return String(meta.email);
  if (typeof meta.remotePath === "string") return String(meta.remotePath);
  if (typeof meta.docId === "number") return `Dokumen #${meta.docId}`;
  if (typeof meta.jobId === "string") return `Job ${String(meta.jobId).slice(0, 8)}...`;
  if (action.startsWith("settings.") && meta.autoScanEnabled != null) {
    return meta.autoScanEnabled ? "Auto scan ON" : "Auto scan OFF";
  }
  return "";
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdminApi();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const range = (sp.get("range") ?? "today") as AuditRange;
  const validRanges: AuditRange[] = ["today", "7d", "30d", "90d"];
  const safeRange = validRanges.includes(range) ? range : "today";
  const since = rangeToSince(safeRange);

  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    50,
    Math.max(10, Number(sp.get("limit") ?? "25") || 25)
  );
  const actionFilter = (sp.get("action") ?? "").trim();
  const errorsOnly = sp.get("errors") === "1";
  const userId = (sp.get("userId") ?? "").trim();

  const whereFinal: {
    createdAt: { gte: Date };
    userId?: string;
    action?: string | { startsWith: string };
  } = {
    createdAt: { gte: since },
  };
  if (userId) whereFinal.userId = userId;
  if (errorsOnly) {
    whereFinal.action = { startsWith: "error." };
  } else if (actionFilter) {
    whereFinal.action = actionFilter;
  }

  const OPENAI_STATS_CAP = 5000;
  const [filteredTotal, eventsTotal, rows, actionGroups, activeUsers, errorCount, openaiAskCount, openaiRows] =
    await Promise.all([
      prisma.auditLog.count({ where: whereFinal }),
      prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      prisma.auditLog.findMany({
        where: whereFinal,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where: { createdAt: { gte: since } },
        _count: true,
        orderBy: { _count: { action: "desc" } },
        take: 20,
      }),
      prisma.auditLog.findMany({
        where: {
          createdAt: { gte: since },
          userId: { not: null },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.auditLog.count({
        where: {
          createdAt: { gte: since },
          action: { startsWith: "error." },
        },
      }),
      prisma.auditLog.count({
        where: {
          createdAt: { gte: since },
          action: "chat.ask",
        },
      }),
      prisma.auditLog.findMany({
        where: {
          createdAt: { gte: since },
          action: "chat.ask",
        },
        orderBy: { createdAt: "desc" },
        select: { action: true, meta: true },
        take: OPENAI_STATS_CAP,
      }),
    ]);

  let promptTokens = 0;
  let completionTokens = 0;
  let embeddingTokens = 0;
  let embeddingHits = 0;
  let chatHits = 0;
  let costUsd = 0;

  for (const row of openaiRows) {
    const meta = parseMeta(row.meta);
    const u = usageFromAuditMeta(meta);
    const rowChat = u.chatHits ?? 0;
    const rowEmbed = u.embeddingHits ?? 0;
    const prompt = u.promptTokens ?? 0;
    const completion = u.completionTokens ?? 0;
    const embedTok = u.embeddingTokens ?? 0;

    if (rowChat > 0) chatHits += rowChat;
    else if (prompt > 0 || completion > 0) chatHits += 1;

    promptTokens += prompt;
    completionTokens += completion;
    embeddingTokens += embedTok;
    embeddingHits += rowEmbed;
    if (typeof u.estimatedCostUsd === "number" && u.estimatedCostUsd > 0) {
      costUsd += u.estimatedCostUsd;
    } else {
      costUsd += estimateCostUsd({
        promptTokens: prompt,
        completionTokens: completion,
        embeddingTokens: embedTok,
      });
    }
  }

  const openaiPartial = openaiAskCount > openaiRows.length;

  const logs = rows.map((r) => {
    const meta = parseMeta(r.meta);
    const desc = describeAuditAction(r.action);
    return {
      id: r.id,
      action: r.action,
      title: desc.title,
      category: desc.category,
      description: desc.description ?? null,
      isError: isErrorAction(r.action),
      summary: metaSummary(r.action, meta),
      meta,
      createdAt: r.createdAt.toISOString(),
      user: r.user
        ? { id: r.user.id, name: r.user.name, email: r.user.email }
        : null,
    };
  });

  return NextResponse.json({
    range: safeRange,
    since: since.toISOString(),
    page,
    pageSize,
    total: filteredTotal,
    hasMore: page * pageSize < filteredTotal,
    stats: {
      events: eventsTotal,
      activeUsers: activeUsers.length,
      errors: errorCount,
      openai: {
        hits: chatHits,
        events: openaiAskCount,
        sampledEvents: openaiRows.length,
        partial: openaiPartial,
        embeddingHits,
        promptTokens,
        completionTokens,
        embeddingTokens,
        totalTokens: promptTokens + completionTokens + embeddingTokens,
        estimatedCostUsd: costUsd,
      },
      byAction: actionGroups.map((g) => ({
        action: g.action,
        count: g._count,
        ...describeAuditAction(g.action),
      })),
    },
    logs,
  });
}
