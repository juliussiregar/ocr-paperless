import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";
import {
  sanitizePaperlessQuery,
  searchDocuments,
  type PaperlessDocument,
} from "@/lib/paperless";
import { humanizeFileName } from "@/lib/display-name";

const PAGE_SIZE = 15;
const MAX_PAPERLESS_PAGES = 16;
const ID_IN_BATCH = 80;

type SortKey = "relevance" | "newest" | "oldest" | "name";

function paperlessOrdering(sort: SortKey): string | undefined {
  switch (sort) {
    case "oldest":
      return "created";
    case "name":
      return "title";
    case "newest":
      return "-created";
    default:
      // Omit ordering so Whoosh keeps relevance for full-text query
      return undefined;
  }
}

function inDateRange(d: PaperlessDocument, from: string, to: string): boolean {
  const created = new Date(d.created).getTime();
  if (from && created < new Date(from).getTime()) return false;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (created > end.getTime()) return false;
  }
  return true;
}

const SNIPPET_CHARS = 320;

/** Build an OCR snippet around the densest query-term window. */
function buildSnippet(content: string, query: string): string {
  const text = (content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9à-ü]+/i)
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (tokens.length === 0) {
    return (
      text.slice(0, SNIPPET_CHARS) + (text.length > SNIPPET_CHARS ? "..." : "")
    );
  }

  const lower = text.toLowerCase();
  // Prefer longest multi-token phrase hit first
  let phraseIdx = -1;
  let phraseLen = 0;
  for (let n = Math.min(4, tokens.length); n >= 2; n--) {
    const phrase = tokens.slice(0, n).join(" ");
    const i = lower.indexOf(phrase);
    if (i !== -1) {
      phraseIdx = i;
      phraseLen = phrase.length;
      break;
    }
  }

  if (phraseIdx !== -1) {
    const start = Math.max(0, phraseIdx - 100);
    const end = Math.min(text.length, phraseIdx + phraseLen + 180);
    let snip = text.slice(start, end);
    if (start > 0) snip = "..." + snip;
    if (end < text.length) snip = snip + "...";
    return snip;
  }

  // Densest window: score token hits in sliding windows
  let bestStart = 0;
  let bestScore = -1;
  const win = SNIPPET_CHARS;
  const step = 60;
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + win);
    const window = lower.slice(start, end);
    let score = 0;
    for (const t of tokens) {
      let from = 0;
      while (from < window.length) {
        const i = window.indexOf(t, from);
        if (i === -1) break;
        score += t.length >= 6 ? 2 : 1;
        from = i + t.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
    if (end >= text.length) break;
  }

  if (bestScore <= 0) {
    return (
      text.slice(0, SNIPPET_CHARS) + (text.length > SNIPPET_CHARS ? "..." : "")
    );
  }

  let snip = text.slice(bestStart, bestStart + win);
  if (bestStart > 0) snip = "..." + snip;
  if (bestStart + win < text.length) snip = snip + "...";
  return snip;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const rawQ = sp.get("q") ?? "";
  const cleaned = sanitizePaperlessQuery(rawQ);
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const folder = (sp.get("folder") ?? "").trim();
  const titleOnly = sp.get("titleOnly") === "1";
  const sort = (sp.get("sort") ?? "relevance") as SortKey;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const folders = await listUserFolders(session.user.id);

  if (!cleaned) {
    return NextResponse.json({
      count: 0,
      page,
      pageSize: PAGE_SIZE,
      hasMore: false,
      countIsPartial: false,
      queryUsed: "",
      querySanitized: false,
      results: [],
      folders,
    });
  }

  try {
    const userId = session.user.id;

    const syncWhere: {
      userId: string;
      syncStatus: { in: SyncStatus[] };
      paperlessDocumentId: { not: null };
      remotePath?: { startsWith: string };
    } = {
      userId,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
    };

    if (folder && folder !== "/") {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      syncWhere.remotePath = { startsWith: prefix };
    }

    const syncRows = await prisma.syncFile.findMany({
      where: syncWhere,
      select: {
        paperlessDocumentId: true,
        remotePath: true,
        fileName: true,
      },
    });

    const allowedIds = [
      ...new Set(
        syncRows
          .map((r) => r.paperlessDocumentId)
          .filter((id): id is number => id != null)
      ),
    ];

    if (allowedIds.length === 0) {
      return NextResponse.json({
        count: 0,
        page,
        pageSize: PAGE_SIZE,
        hasMore: false,
        countIsPartial: false,
        queryUsed: cleaned,
        querySanitized: cleaned !== rawQ.trim(),
        results: [],
        folders,
      });
    }

    const allowed = new Set(allowedIds);
    const pathByDoc = new Map(
      syncRows
        .filter((p) => p.paperlessDocumentId != null)
        .map((p) => [
          p.paperlessDocumentId!,
          { remotePath: p.remotePath, fileName: p.fileName },
        ])
    );

    const ordering =
      sort === "relevance" && !titleOnly
        ? undefined
        : paperlessOrdering(sort === "relevance" ? "newest" : sort);

    let matched: PaperlessDocument[] = [];
    let countIsPartial = false;

    // Fast path: scope to user IDs (accurate count for small libraries)
    if (allowedIds.length <= 200) {
      const byId = new Map<number, PaperlessDocument>();
      for (let i = 0; i < allowedIds.length; i += ID_IN_BATCH) {
        const chunk = allowedIds.slice(i, i + ID_IN_BATCH);
        let p = 1;
        let more = true;
        while (more && p <= 5) {
          const batch = await searchDocuments(cleaned, {
            page: p,
            pageSize: Math.min(100, chunk.length),
            idIn: chunk,
            titleOnly,
            ...(ordering ? { ordering } : {}),
          });
          for (const d of batch.results) {
            if (allowed.has(d.id) && inDateRange(d, from, to)) {
              byId.set(d.id, d);
            }
          }
          more = Boolean(batch.next) && batch.results.length > 0;
          p += 1;
        }
      }
      matched = [...byId.values()];
    } else {
      // Large library: walk global Paperless pages, filter to user
      let paperlessPage = 1;
      let exhausted = false;
      const need = page * PAGE_SIZE;

      while (paperlessPage <= MAX_PAPERLESS_PAGES && !exhausted) {
        const batch = await searchDocuments(cleaned, {
          page: paperlessPage,
          pageSize: 50,
          titleOnly,
          ...(ordering ? { ordering } : {}),
        });

        for (const d of batch.results) {
          if (!allowed.has(d.id)) continue;
          if (!inDateRange(d, from, to)) continue;
          matched.push(d);
        }

        if (!batch.next || batch.results.length === 0) {
          exhausted = true;
        } else {
          paperlessPage += 1;
        }

        // Enough for this page response, but more may exist
        if (matched.length >= need && !exhausted) {
          countIsPartial = true;
          break;
        }
      }

      if (!exhausted && paperlessPage > MAX_PAPERLESS_PAGES) {
        countIsPartial = true;
      }
    }

    // Dedupe
    const seen = new Set<number>();
    matched = matched.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    if (sort === "name") {
      matched.sort((a, b) =>
        humanizeFileName(a.title || a.original_file_name).localeCompare(
          humanizeFileName(b.title || b.original_file_name),
          "id"
        )
      );
    } else if (sort === "newest") {
      matched.sort(
        (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
      );
    } else if (sort === "oldest") {
      matched.sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
      );
    }

    const count = matched.length;
    const start = (page - 1) * PAGE_SIZE;
    const slice = matched.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < count || countIsPartial;

    const results = slice.map((d) => {
      const meta = pathByDoc.get(d.id);
      const fileName = meta?.fileName || d.original_file_name;
      return {
        id: d.id,
        title: d.title,
        fileName,
        displayName: humanizeFileName(d.title || fileName),
        remotePath: meta?.remotePath ?? null,
        content: buildSnippet(d.content ?? "", cleaned),
        pageCount: d.page_count,
        created: d.created,
        modified: d.modified,
      };
    });

    return NextResponse.json({
      count,
      countIsPartial,
      page,
      pageSize: PAGE_SIZE,
      hasMore,
      queryUsed: cleaned,
      querySanitized: cleaned !== rawQ.trim(),
      results,
      folders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function listUserFolders(userId: string): Promise<string[]> {
  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
    },
    select: { remotePath: true },
    take: 800,
  });
  const folders = new Set<string>();
  for (const r of rows) {
    const parts = r.remotePath.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    folders.add("/" + parts.slice(0, -1).join("/"));
  }
  return [...folders].sort((a, b) => a.localeCompare(b, "id")).slice(0, 40);
}
