import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { createUserWebDav } from "@/lib/webdav";
import { rateLimit } from "@/lib/rate-limit";

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function folderLabel(p: string): string {
  if (p === "/") return "Root";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const withCounts = request.nextUrl.searchParams.get("counts") === "1";

  const rows = await prisma.cloudFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: 12,
  });

  if (!withCounts) {
    return NextResponse.json({
      favorites: rows.map((r) => ({
        path: r.path,
        label: folderLabel(r.path),
        lastOpenedAt: r.lastOpenedAt.toISOString(),
        newCount: 0,
      })),
    });
  }

  const creds = await getUserBappenasCreds(userId);
  const favorites = await Promise.all(
    rows.map(async (r) => {
      let newCount = 0;
      if (creds) {
        try {
          const client = createUserWebDav(
            creds.url,
            creds.username,
            creds.password
          );
          newCount = await client.countNewInFolder(r.path, r.lastOpenedAt);
        } catch {
          newCount = 0;
        }
      }
      return {
        path: r.path,
        label: folderLabel(r.path),
        lastOpenedAt: r.lastOpenedAt.toISOString(),
        newCount,
      };
    })
  );

  return NextResponse.json({ favorites });
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-fav:${session.user.id}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = body.action as string;
  const path = normalizePath(typeof body.path === "string" ? body.path : "");

  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const userId = session.user.id;

  if (action === "add") {
    const count = await prisma.cloudFavorite.count({ where: { userId } });
    if (count >= 12) {
      return NextResponse.json(
        { error: "Maksimal 12 folder favorit" },
        { status: 400 }
      );
    }
    await prisma.cloudFavorite.upsert({
      where: { userId_path: { userId, path } },
      create: { userId, path, lastOpenedAt: new Date() },
      update: {},
    });
  } else if (action === "remove") {
    await prisma.cloudFavorite.deleteMany({ where: { userId, path } });
  } else if (action === "open") {
    await prisma.cloudFavorite.updateMany({
      where: { userId, path },
      data: { lastOpenedAt: new Date() },
    });
  } else {
    return NextResponse.json({ error: "action tidak dikenal" }, { status: 400 });
  }

  const rows = await prisma.cloudFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: 12,
  });

  return NextResponse.json({
    favorites: rows.map((r) => ({
      path: r.path,
      label: folderLabel(r.path),
      lastOpenedAt: r.lastOpenedAt.toISOString(),
      newCount: 0,
    })),
  });
}
