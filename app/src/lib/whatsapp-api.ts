import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ChatCitation } from "@/lib/openai";
import { getDocument, getPaperlessToken, getPaperlessUrl } from "@/lib/paperless";

const DEFAULT_WHATSAPP_USER_EMAIL = "triando@gmail.com";
const MAX_WHATSAPP_DOCUMENTS = 3;
const SNIPPET_CHARS = 400;
const DEFAULT_FILE_MAX_BYTES = 15 * 1024 * 1024;

function maxWhatsAppFileBytes(): number {
  const n = Number(process.env.WHATSAPP_FILE_MAX_BYTES ?? String(DEFAULT_FILE_MAX_BYTES));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FILE_MAX_BYTES;
}

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
  /** Set when includeFiles=true */
  contentType?: string | null;
  fileBase64?: string | null;
  fileIncluded?: boolean;
  fileError?: string | null;
};

async function fetchPaperlessPdfBytes(docId: number): Promise<{
  bytes: Buffer | null;
  contentType: string;
  error?: string;
}> {
  const token = getPaperlessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(
    `${getPaperlessUrl()}/api/documents/${docId}/download/`,
    { headers }
  );

  if (!res.ok) {
    return {
      bytes: null,
      contentType: "application/pdf",
      error: `Download gagal (${res.status})`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "application/pdf";
  const buf = Buffer.from(await res.arrayBuffer());
  const max = maxWhatsAppFileBytes();
  if (buf.length > max) {
    return {
      bytes: null,
      contentType,
      error: `File terlalu besar (${buf.length} B, max ${max} B)`,
    };
  }

  return { bytes: buf, contentType };
}

export async function buildWhatsAppDocuments(
  citations: ChatCitation[],
  userId: string,
  baseUrl: string,
  options?: { includeFiles?: boolean }
): Promise<WhatsAppDocumentPayload[]> {
  const includeFiles = options?.includeFiles ?? true;
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

    const payload: WhatsAppDocumentPayload = {
      id: c.id,
      title: c.title,
      fileName: c.fileName,
      remotePath: sync?.remotePath ?? null,
      fileSize:
        sync?.fileSize != null ? Number(sync.fileSize) : null,
      snippet,
      downloadUrl: `${baseUrl}/api/integrations/whatsapp/documents/${c.id}/download`,
    };

    if (includeFiles) {
      try {
        const file = await fetchPaperlessPdfBytes(c.id);
        if (file.bytes) {
          payload.contentType = file.contentType;
          payload.fileBase64 = file.bytes.toString("base64");
          payload.fileIncluded = true;
        } else {
          payload.contentType = file.contentType;
          payload.fileBase64 = null;
          payload.fileIncluded = false;
          payload.fileError = file.error ?? "File tidak tersedia";
        }
      } catch (err) {
        payload.fileBase64 = null;
        payload.fileIncluded = false;
        payload.fileError =
          err instanceof Error ? err.message.slice(0, 200) : "Gagal mengambil file";
      }
    }

    out.push(payload);
  }

  return out;
}
