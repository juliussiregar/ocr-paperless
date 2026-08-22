import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { createUserWebDav } from "@/lib/webdav";
import { rateLimit } from "@/lib/rate-limit";

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

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "NO_CREDS", code: "NO_CREDS", entries: [] },
      { status: 400 }
    );
  }

  try {
    const client = createUserWebDav(creds.url, creds.username, creds.password);
    const listed = await client.listDirectory(path);

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

    const folders = listed
      .filter((e) => e.type === "directory")
      .map((e) => ({
        path: e.path.replace(/\/$/, "") || "/",
        name: e.name,
        type: "directory" as const,
        isPdf: false,
        paperlessDocumentId: null as number | null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const files = listed
      .filter((e) => e.type === "file")
      .map((e) => ({
        path: e.path.replace(/\/$/, "") || e.path,
        name: e.name,
        type: "file" as const,
        isPdf: Boolean(e.isPdf),
        paperlessDocumentId: byPath.get(e.path)?.paperlessDocumentId ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const entries = [...folders, ...files];

    return NextResponse.json({
      path,
      entries,
      // keep folders for older clients
      folders: folders.map(({ path: p, name }) => ({ path: p, name })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memuat tree";
    return NextResponse.json({ error: message, entries: [] }, { status: 502 });
  }
}
