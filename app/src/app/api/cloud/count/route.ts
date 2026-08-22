import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { createUserWebDav } from "@/lib/webdav";

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/** Preview how many PDFs are under a folder (for confirm dialog). */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const path = normalizePath(
    request.nextUrl.searchParams.get("path") ?? "/"
  );

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "Kredensial belum diisi", code: "NO_CREDS" },
      { status: 400 }
    );
  }

  try {
    const client = createUserWebDav(creds.url, creds.username, creds.password);
    const { total, truncated } = await client.countPdfs(path);
    return NextResponse.json({ path, total, truncated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal menghitung";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
