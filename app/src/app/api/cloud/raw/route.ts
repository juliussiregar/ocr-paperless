import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { createUserWebDav } from "@/lib/webdav";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

/** Stream original file from Cloud Bappenas (WebDAV), not Paperless. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-raw:${session.user.id}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const pathParam = request.nextUrl.searchParams.get("path") ?? "";
  if (!pathParam || !pathParam.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "path PDF required" }, { status: 400 });
  }
  const remotePath = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "Kredensial Cloud Bappenas belum diisi.", code: "NO_CREDS" },
      { status: 400 }
    );
  }

  try {
    const client = createUserWebDav(creds.url, creds.username, creds.password);
    const buf = await client.downloadFile(remotePath);
    const fileName =
      remotePath.split("/").filter(Boolean).pop() ?? "document.pdf";

    await writeAudit("cloud.raw_download", session.user.id, { remotePath });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[cloud/raw]", err);
    return NextResponse.json(
      { error: "Gagal mengunduh file dari Cloud Bappenas" },
      { status: 502 }
    );
  }
}
