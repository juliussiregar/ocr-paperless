import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";
import { humanizeFileName } from "@/lib/display-name";

/** 5 file terbaru yang sudah berhasil di-OCR ke aplikasi */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const files = await prisma.syncFile.findMany({
    where: {
      userId: session.user.id,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
    },
    orderBy: [{ lastSyncedAt: "desc" }, { updatedAt: "desc" }],
    take: 5,
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
  });

  return NextResponse.json({
    files: files.map((f) => ({
      ...f,
      displayName: humanizeFileName(f.fileName),
      fileSize: f.fileSize !== null ? Number(f.fileSize) : null,
    })),
  });
}
