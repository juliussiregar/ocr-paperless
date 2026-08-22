import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserBappenasCreds, mapSyncStatusToUi } from "@/lib/bappenas";
import { createUserWebDav } from "@/lib/webdav";
import { rateLimit } from "@/lib/rate-limit";
import { humanizeFileName } from "@/lib/display-name";

/** Search PDF filenames across cloud (BFS) + SyncFile index. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-search:${session.user.id}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [], query: q });
  }

  const take = Math.min(
    40,
    Math.max(1, Number(request.nextUrl.searchParams.get("take") ?? "30") || 30)
  );

  const userId = session.user.id;

  const tokens = q
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 5);

  const indexed = await prisma.syncFile.findMany({
    where: {
      userId,
      AND: tokens.map((t) => ({
        OR: [
          { fileName: { contains: t, mode: "insensitive" as const } },
          { remotePath: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      remotePath: true,
      fileName: true,
      syncStatus: true,
      paperlessDocumentId: true,
      fileSize: true,
      lastModified: true,
      errorMessage: true,
    },
  });

  type SearchHit = {
    path: string;
    name: string;
    displayName: string;
    size: number | null;
    lastModified: string | null;
    ingestStatus: ReturnType<typeof mapSyncStatusToUi>;
    syncStage: string | null;
    paperlessDocumentId: number | null;
    errorMessage: string | null;
    source: "index" | "cloud";
  };

  const byPath = new Map<string, SearchHit>(
    indexed.map((r) => [
      r.remotePath,
      {
        path: r.remotePath,
        name: r.fileName,
        displayName: humanizeFileName(r.fileName),
        size: r.fileSize != null ? Number(r.fileSize) : null,
        lastModified: r.lastModified?.toISOString() ?? null,
        ingestStatus: mapSyncStatusToUi(r.syncStatus),
        syncStage: r.syncStatus as string | null,
        paperlessDocumentId: r.paperlessDocumentId,
        errorMessage: r.errorMessage,
        source: "index",
      },
    ])
  );

  const creds = await getUserBappenasCreds(userId);
  if (creds && byPath.size < take) {
    try {
      const client = createUserWebDav(creds.url, creds.username, creds.password);
      const live = await client.searchByName(q, {
        maxResults: take,
        maxDirs: 100,
      });
      for (const e of live) {
        if (byPath.has(e.path)) continue;
        byPath.set(e.path, {
          path: e.path,
          name: e.name,
          displayName: humanizeFileName(e.name),
          size: e.size,
          lastModified: e.lastModified,
          ingestStatus: "not_ingested" as const,
          syncStage: null,
          paperlessDocumentId: null,
          errorMessage: null,
          source: "cloud" as const,
        });
        if (byPath.size >= take) break;
      }
    } catch (err) {
      console.error("[cloud/search] live", err);
    }
  }

  const results = [...byPath.values()].slice(0, take);
  return NextResponse.json({ results, query: q });
}
