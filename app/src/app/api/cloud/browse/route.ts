import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserBappenasCreds, mapSyncStatusToUi } from "@/lib/bappenas";
import { rateLimit } from "@/lib/rate-limit";
import { buildFolderStatsMap, nestedSyncFileFilter } from "@/lib/folder-stats";
import { fetchDirectoryListing, getCachedListing } from "@/lib/cloud-listing-cache";
import { summarizeCloudFolder } from "@/lib/cloud-folder-hint";
import { folderDisplaySizeBytes } from "@/lib/folder-display-size";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-browse:${session.user.id}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const pathParam = request.nextUrl.searchParams.get("path") ?? "/";
  const path = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (refresh) {
    const refreshRl = rateLimit(
      `cloud-browse-refresh:${session.user.id}`,
      20,
      60_000
    );
    if (!refreshRl.ok) {
      return NextResponse.json(
        {
          error: `Refresh terlalu sering. Coba lagi dalam ${refreshRl.retryAfterSec}s`,
        },
        { status: 429 }
      );
    }
  }

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "Kredensial Cloud Bappenas belum diisi. Lengkapi di Profil terlebih dahulu.",
        code: "NO_CREDS",
      },
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
    const entries = listing.entries;

    const filePaths = entries
      .filter((e) => e.type === "file")
      .map((e) => e.path);

    const dirPaths = entries
      .filter((e) => e.type === "directory")
      .map((e) => e.path);

    const parentNorm = path === "/" ? "/" : path.replace(/\/$/, "");

    const nestedFilter = nestedSyncFileFilter(session.user.id, dirPaths);

    const [syncRows, nestedSyncRows] = await Promise.all([
      filePaths.length > 0
        ? prisma.syncFile.findMany({
            where: {
              userId: session.user.id,
              remotePath: { in: filePaths },
            },
            select: {
              remotePath: true,
              syncStatus: true,
              errorMessage: true,
              paperlessDocumentId: true,
              fileSize: true,
            },
          })
        : Promise.resolve([]),
      nestedFilter
        ? prisma.syncFile.findMany({
            where: nestedFilter,
            select: {
              remotePath: true,
              syncStatus: true,
              fileSize: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const byPath = new Map(syncRows.map((r) => [r.remotePath, r]));
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

    const items = entries.map((e) => {
      if (e.type === "directory") {
        const folderStats = folderStatsMap.get(e.path) ?? null;
        const cloudHint = hintByPath.get(e.path) ?? null;
        const folderSizeBytes = folderDisplaySizeBytes(folderStats, cloudHint);
        return {
          ...e,
          ingestStatus: null as null,
          syncStage: null as null,
          errorMessage: null as string | null,
          paperlessDocumentId: null as number | null,
          syncedFileSize: null as number | null,
          isZeroByte: false,
          folderStats,
          cloudHint,
          folderSizeBytes,
          selectable: false,
        };
      }

      const sync = byPath.get(e.path);
      const syncStage = sync?.syncStatus ?? null;
      const ingestStatus = mapSyncStatusToUi(syncStage);
      const selectable =
        e.isIngestible &&
        (ingestStatus === "not_ingested" || ingestStatus === "failed");
      const syncedFileSize =
        sync?.fileSize != null ? Number(sync.fileSize) : null;
      const cloudZero = e.size === 0;
      const syncedZero = syncedFileSize === 0;

      return {
        ...e,
        ingestStatus,
        syncStage,
        errorMessage: sync?.errorMessage ?? null,
        paperlessDocumentId: sync?.paperlessDocumentId ?? null,
        syncedFileSize,
        isZeroByte: cloudZero || syncedZero,
        folderStats: null,
        cloudHint: null,
        selectable,
      };
    });

    const parts = path === "/" ? [] : path.split("/").filter(Boolean);
    const breadcrumbs = [
      { name: "Root", path: "/" },
      ...parts.map((name, i) => ({
        name,
        path: "/" + parts.slice(0, i + 1).join("/"),
      })),
    ];

    return NextResponse.json({
      path: path === "/" ? "/" : path.replace(/\/$/, ""),
      breadcrumbs,
      items,
      listingCached: listing.listingCached,
      listingStale: listing.listingStale,
      listingCachedAt: listing.listingCachedAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal membaca folder cloud";
    console.error("[cloud/browse]", message);
    return NextResponse.json(
      {
        error:
          "Gagal mengakses Cloud Bappenas. Periksa kredensial atau coba lagi.",
        detail: message,
      },
      { status: 502 }
    );
  }
}
