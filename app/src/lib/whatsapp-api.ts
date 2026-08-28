import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ChatCitation } from "@/lib/openai";
import { getDocument } from "@/lib/paperless";

const DEFAULT_WHATSAPP_USER_EMAIL = "triando@gmail.com";
const MAX_WHATSAPP_DOCUMENTS = 3;
const SNIPPET_CHARS = 400;

export function whatsAppUserEmail(): string {
  const email = process.env.WHATSAPP_USER_EMAIL?.trim();
  return email || DEFAULT_WHATSAPP_USER_EMAIL;
}

export async function getWhatsAppIntegrationUser(): Promise<{
  id: string;
  email: string;
  name: string;
} | null> {
  return prisma.user.findUnique({
    where: { email: whatsAppUserEmail() },
    select: { id: true, email: true, name: true },
  });
}

/** Public base URL for download links (NEXTAUTH_URL preferred). */
export function publicAppBaseUrl(request: NextRequest): string {
  const fromEnv = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://127.0.0.1:3000";
}

export type WhatsAppDocumentPayload = {
  id: number;
  title: string;
  fileName: string;
  remotePath: string | null;
  fileSize: number | null;
  snippet: string;
  downloadUrl: string;
};

export async function buildWhatsAppDocuments(
  citations: ChatCitation[],
  userId: string,
  baseUrl: string
): Promise<WhatsAppDocumentPayload[]> {
  const take = citations.slice(0, MAX_WHATSAPP_DOCUMENTS);
  const out: WhatsAppDocumentPayload[] = [];

  for (const c of take) {
    const sync = await prisma.syncFile.findFirst({
      where: { userId, paperlessDocumentId: c.id },
      select: { remotePath: true, fileName: true, fileSize: true },
    });

    let snippet = "";
    try {
      const doc = await getDocument(c.id);
      const text = (doc.content ?? "").replace(/\s+/g, " ").trim();
      snippet =
        text.length <= SNIPPET_CHARS
          ? text
          : `${text.slice(0, SNIPPET_CHARS)}...`;
    } catch {
      snippet = "";
    }

    out.push({
      id: c.id,
      title: c.title,
      fileName: c.fileName,
      remotePath: sync?.remotePath ?? null,
      fileSize:
        sync?.fileSize != null ? Number(sync.fileSize) : null,
      snippet,
      downloadUrl: `${baseUrl}/api/integrations/whatsapp/documents/${c.id}/download`,
    });
  }

  return out;
}
