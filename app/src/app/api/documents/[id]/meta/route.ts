import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDocument } from "@/lib/paperless";
import { userOwnsPaperlessDoc } from "@/lib/user-docs";
import { humanizeFileName } from "@/lib/display-name";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const owns = await userOwnsPaperlessDoc(session.user.id, id);
  if (!owns) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sync = await prisma.syncFile.findFirst({
    where: { userId: session.user.id, paperlessDocumentId: id },
    select: { fileName: true, remotePath: true },
  });

  try {
    const doc = await getDocument(id);
    const fileName = sync?.fileName || doc.original_file_name || doc.title;
    return NextResponse.json({
      id,
      title: doc.title,
      fileName,
      remotePath: sync?.remotePath ?? null,
      displayName: humanizeFileName(doc.title || fileName),
      pageCount: doc.page_count,
    });
  } catch {
    const fileName = sync?.fileName || `Dokumen ${id}`;
    return NextResponse.json({
      id,
      title: fileName,
      fileName,
      remotePath: sync?.remotePath ?? null,
      displayName: humanizeFileName(fileName),
      pageCount: null,
    });
  }
}
