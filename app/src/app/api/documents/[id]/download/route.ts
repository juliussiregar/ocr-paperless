import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { userOwnsPaperlessDoc } from "@/lib/user-docs";
import { getPaperlessToken, getPaperlessUrl } from "@/lib/paperless";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const owns = await userOwnsPaperlessDoc(session.user.id, docId);
  if (!owns && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const known = await prisma.syncFile.findFirst({
    where: {
      paperlessDocumentId: docId,
      ...(owns ? { userId: session.user.id } : {}),
    },
    select: { id: true, fileName: true },
  });

  const token = getPaperlessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(
    `${getPaperlessUrl()}/api/documents/${docId}/download/`,
    { headers }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const blob = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "application/pdf";
  const filename = known?.fileName ?? `document-${docId}.pdf`;

  await writeAudit("document.download", session.user.id, { docId, filename });

  return new NextResponse(blob, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}
