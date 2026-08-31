import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { rateLimit } from "@/lib/rate-limit";
import { warmListingCaches } from "@/lib/cloud-listing-cache";

/** Prefetch listing cache for folder paths (background warm). */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-cache-warm:${session.user.id}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu sering. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const rawPaths: unknown[] = Array.isArray(body.paths) ? body.paths : [];
  const paths = rawPaths
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => (p.startsWith("/") ? p : `/${p}`));

  if (paths.length === 0) {
    return NextResponse.json({ error: "paths wajib" }, { status: 400 });
  }

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json({ error: "NO_CREDS", code: "NO_CREDS" }, { status: 400 });
  }

  const max = typeof body.max === "number" ? Math.min(body.max, 24) : 16;
  const result = await warmListingCaches(session.user.id, paths, creds, {
    max,
  });

  return NextResponse.json({ ok: true, ...result });
}
