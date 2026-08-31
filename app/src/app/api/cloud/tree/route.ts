import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { rateLimit } from "@/lib/rate-limit";
import { buildFolderStatsMap, nestedSyncFileFilter } from "@/lib/folder-stats";
import {
  fetchDirectoryListing,
  getCachedListing,
} from "@/lib/cloud-listing-cache";
import { summarizeCloudFolder } from "@/lib/cloud-folder-hint";
import { folderDisplaySizeBytes } from "@/lib/folder-display-size";

/** Shallow children of a folder for sidebar tree (folders + files). */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-tree:${session.user.id}`, 80, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const pathParam = request.nextUrl.searchParams.get("path") ?? "/";
  const path = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "NO_CREDS", code: "NO_CREDS", entries: [] },
      { status: 400 }
    );
  }

  try {
    const listing = await fetchDirectoryListing(
      session.user.id,
      path,
      creds,
      { refresh }
    );
    const listed = listing.entries;

    const filePaths = listed
      .filter((e) => e.type === "file")
      .map((e) => e.path);

    const syncRows =
      filePaths.length > 0
        ? await prisma.syncFile.findMany({
            where: {
              userId: session.user.id,
              remotePath: { in: filePaths },
            },
            select: {
              remotePath: true,
              paperlessDocumentId: true,
            },
          })
        : [];
    const byPath = new Map(syncRows.map((r) => [r.remotePath, r]));

    const dirPaths = listed
      .filter((e) => e.type === "directory")
      .map((e) => e.path.replace(/\/$/, "") || "/");
    const parentNorm = path === "/" ? "/" : path.replace(/\/$/, "");

    const nestedFilter = nestedSyncFileFilter(session.user.id, dirPaths);
    const nestedSyncRows = nestedFilter
      ? await prisma.syncFile.findMany({
          where: nestedFilter,
          select: {
            remotePath: true,
            syncStatus: true,
            fileSize: true,
          },
        })
      : [];
    const folderStatsMap = buildFolderStatsMap(
      parentNorm,
      dirPaths,
      nestedSyncRows
    );

    const cachedHints = await Promise.all(
      dirPaths.map(async (dirPath) => {
        const cached = await getCachedListing(session.user.id, dirPath);
        if (!cached) return null;
        return {
          path: dirPath,
          hint: summarizeCloudFolder(cached.entries),
        };
      })
    );
    const hintByPath = new Map(
      cachedHints
        .filter((row): row is NonNullable<typeof row> => row != null)
        .map((row) => [row.path, row.hint])
    );

    const folders = listed
      .filter((e) => e.type === "directory")
      .map((e) => {
        const folderPath = e.path.replace(/\/$/, "") || "/";
        const stats = folderStatsMap.get(folderPath) ?? null;
        const hint = hintByPath.get(folderPath) ?? null;
        return {
          path: folderPath,
          name: e.name,
          type: "directory" as const,
          isPdf: false,
          paperlessDocumentId: null as number | null,
          sizeBytes: folderDisplaySizeBytes(stats, hint),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const files = listed
      .filter((e) => e.type === "file")
      .map((e) => ({
        path: e.path.replace(/\/$/, "") || e.path,
        name: e.name,
        type: "file" as const,
        isPdf: Boolean(e.isPdf),
        isIngestible: Boolean(e.isIngestible),
        paperlessDocumentId: byPath.get(e.path)?.paperlessDocumentId ?? null,
        sizeBytes: e.size ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const entries = [...folders, ...files];

    return NextResponse.json({
      path,
      entries,
      listingCached: listing.listingCached,
      listingStale: listing.listingStale,
      listingCachedAt: listing.listingCachedAt,
      folders: folders.map(({ path: p, name }) => ({ path: p, name })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memuat tree";
    return NextResponse.json({ error: message, entries: [] }, { status: 502 });
  }
}
