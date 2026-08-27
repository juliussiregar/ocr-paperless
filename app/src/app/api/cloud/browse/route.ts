import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserBappenasCreds, mapSyncStatusToUi } from "@/lib/bappenas";
import { createUserWebDav } from "@/lib/webdav";
import { rateLimit } from "@/lib/rate-limit";
import { buildFolderStatsMap } from "@/lib/folder-stats";

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
    const client = createUserWebDav(creds.url, creds.username, creds.password);
    const entries = await client.listDirectory(path);

    const filePaths = entries
      .filter((e) => e.type === "file")
      .map((e) => e.path);

    const dirPaths = entries
      .filter((e) => e.type === "directory")
      .map((e) => e.path);

    const parentNorm = path === "/" ? "/" : path.replace(/\/$/, "");
    const browsePrefix = parentNorm === "/" ? "/" : `${parentNorm}/`;

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
      dirPaths.length > 0
        ? prisma.syncFile.findMany({
            where: {
              userId: session.user.id,
              remotePath: { startsWith: browsePrefix },
            },
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

    const items = entries.map((e) => {
      if (e.type === "directory") {
        const folderStats = folderStatsMap.get(e.path) ?? null;
        return {
          ...e,
          ingestStatus: null as null,
          syncStage: null as null,
          errorMessage: null as string | null,
          paperlessDocumentId: null as number | null,
          syncedFileSize: null as number | null,
          isZeroByte: false,
          folderStats,
          cloudHint: null as null,
          selectable: false,
        };
      }

      const sync = byPath.get(e.path);
      const syncStage = sync?.syncStatus ?? null;
      const ingestStatus = mapSyncStatusToUi(syncStage);
      const selectable =
        e.isPdf &&
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
