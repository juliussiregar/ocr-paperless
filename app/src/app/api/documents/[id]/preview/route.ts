import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { userOwnsPaperlessDoc } from "@/lib/user-docs";
import { getPaperlessToken, getPaperlessUrl } from "@/lib/paperless";

export const runtime = "nodejs";

/** Proxy PDF for in-browser preview (inline disposition) */
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
    return NextResponse.json(
      {
        error:
          "Dokumen belum terhubung ke akun Anda (OCR belum selesai / belum di-link). Refresh halaman Cloud lalu coba lagi.",
      },
      { status: 403 }
    );
  }

  const token = getPaperlessToken();
  const paperlessUrl = getPaperlessUrl();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "PAPERLESS_TOKEN / PAPERLESS_API_TOKEN belum terbaca. Restart npm run dev setelah mengisi app/.env.local.",
      },
      { status: 503 }
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Token ${token}`,
  };

  let res: Response;
  try {
    res = await fetch(`${paperlessUrl}/api/documents/${docId}/download/`, {
      headers,
    });
  } catch (err) {
    console.error("[preview] paperless fetch failed", err);
    return NextResponse.json(
      { error: `Gagal menghubungi Paperless di ${paperlessUrl}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    console.error(
      `[preview] paperless download ${docId} → ${res.status} ${res.statusText}`
    );
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { error: "Token Paperless tidak valid. Periksa PAPERLESS_TOKEN." },
        { status: 502 }
      );
    }
    if (res.status === 404) {
      return NextResponse.json(
        { error: `File PDF tidak ada di Paperless (id ${docId})` },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: `Paperless error ${res.status}` },
      { status: 502 }
    );
  }

  const blob = await res.arrayBuffer();
  await writeAudit("document.preview", session.user.id, { docId });

  return new NextResponse(blob, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}
