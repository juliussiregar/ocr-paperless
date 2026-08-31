import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  aggregateAiUsageSince,
  getLifetimeAiUsage,
} from "@/lib/ai-usage-aggregate";
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
  if (typeof meta.jobId === "string")
    return `Job ${String(meta.jobId).slice(0, 8)}...`;
  if (action.startsWith("settings.") && meta.autoScanEnabled != null) {
    return meta.autoScanEnabled ? "Auto scan ON" : "Auto scan OFF";
  }
  return "";
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdminApi();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const range = (sp.get("range") ?? "30d") as AuditRange;
  const validRanges: AuditRange[] = ["today", "7d", "30d", "90d"];
  const safeRange = validRanges.includes(range) ? range : "30d";
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

  const [filteredTotal, eventsTotal, rows, actionGroups, activeUsers, errorCount, periodOpenAi, lifetimeOpenAi] =
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
      aggregateAiUsageSince(since),
      getLifetimeAiUsage(),
    ]);

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
        lifetime: lifetimeOpenAi,
        period: periodOpenAi,
        // Legacy fields = period (for older clients)
        hits: periodOpenAi.hits,
        events: periodOpenAi.events,
        embeddingHits: periodOpenAi.embeddingHits,
        promptTokens: periodOpenAi.promptTokens,
        completionTokens: periodOpenAi.completionTokens,
        embeddingTokens: periodOpenAi.embeddingTokens,
        totalTokens: periodOpenAi.totalTokens,
        estimatedCostUsd: periodOpenAi.estimatedCostUsd,
        partial: false,
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
