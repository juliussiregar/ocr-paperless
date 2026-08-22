import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma, SyncStatus } from "@prisma/client";
import { humanizeFileName } from "@/lib/display-name";

/** Full-library doc search for Ask @ mention (not limited to recent 40). */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const take = Math.min(
    30,
    Math.max(1, Number(request.nextUrl.searchParams.get("take") ?? "12") || 12)
  );

  const where: Prisma.SyncFileWhereInput = {
    userId: session.user.id,
    syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
    paperlessDocumentId: { not: null },
  };

  if (q.length >= 1) {
    const tokens = q
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .slice(0, 5);
    where.AND = tokens.map((t) => ({
      OR: [
        { fileName: { contains: t, mode: "insensitive" } },
        { remotePath: { contains: t, mode: "insensitive" } },
      ],
    }));
  }

  const files = await prisma.syncFile.findMany({
    where,
    orderBy: { lastSyncedAt: "desc" },
    take,
    select: {
      fileName: true,
      remotePath: true,
      paperlessDocumentId: true,
    },
  });

  const docs = files
    .filter((f) => f.paperlessDocumentId != null)
    .map((f) => ({
      id: f.paperlessDocumentId as number,
      fileName: f.fileName,
      remotePath: f.remotePath,
      displayName: humanizeFileName(f.fileName),
    }));

  return NextResponse.json({ docs, query: q });
}
