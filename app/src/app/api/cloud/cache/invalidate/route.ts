import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { invalidateCloudCaches } from "@/lib/cloud-cache-invalidate";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawPaths: unknown[] = Array.isArray(body.paths) ? body.paths : [];
  const paths = rawPaths
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => (p.startsWith("/") ? p : `/${p}`));

  if (paths.length === 0) {
    return NextResponse.json({ error: "paths wajib" }, { status: 400 });
  }

  const invalidated = await invalidateCloudCaches(session.user.id, paths, {
    invalidateLive: body.invalidateLive !== false,
  });

  return NextResponse.json({ ok: true, invalidated });
}
