import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { userOwnsPaperlessDoc } from "@/lib/user-docs";
import { getPaperlessToken, getPaperlessUrl } from "@/lib/paperless";
import { getWhatsAppIntegrationUser } from "@/lib/whatsapp-api";

export const runtime = "nodejs";

/** Download PDF for WhatsApp bot (open endpoint, fixed integration user). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getWhatsAppIntegrationUser();
  if (!user) {
    return NextResponse.json({ error: "Integration user not found" }, { status: 404 });
  }

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const owns = await userOwnsPaperlessDoc(user.id, docId);
  if (!owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const known = await prisma.syncFile.findFirst({
    where: { userId: user.id, paperlessDocumentId: docId },
    select: { fileName: true },
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

  await writeAudit("document.download.whatsapp", user.id, {
    docId,
    filename,
    channel: "whatsapp",
  });

  return new NextResponse(blob, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}
