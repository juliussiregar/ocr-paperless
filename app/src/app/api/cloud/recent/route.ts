import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";
import { humanizeFileName } from "@/lib/display-name";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** File terbaru yang sudah berhasil di-OCR (paginated). */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const rawLimit = Number(sp.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
  const pageSize = Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)));

  const where = {
    userId: session.user.id,
    syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
    paperlessDocumentId: { not: null },
  };

  const [total, files] = await Promise.all([
    prisma.syncFile.count({ where }),
    prisma.syncFile.findMany({
      where,
      orderBy: [{ lastSyncedAt: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        fileName: true,
        remotePath: true,
        lastSyncedAt: true,
        updatedAt: true,
        paperlessDocumentId: true,
        fileSize: true,
        syncStatus: true,
      },
    }),
  ]);

  return NextResponse.json({
    files: files.map((f) => ({
      ...f,
      displayName: humanizeFileName(f.fileName),
      fileSize: f.fileSize !== null ? Number(f.fileSize) : null,
    })),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
}
