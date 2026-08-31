import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserBappenasCreds } from "@/lib/bappenas";
import { rateLimit } from "@/lib/rate-limit";
import {
  emptyCloudFolderHint,
  summarizeCloudFolder,
} from "@/lib/cloud-folder-hint";
import {
  fetchDirectoryListing,
  getCachedListing,
} from "@/lib/cloud-listing-cache";

/** Immediate cloud listing stats for one folder (lazy, on hover). */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`cloud-folder-hint:${session.user.id}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const pathParam = request.nextUrl.searchParams.get("path");
  if (!pathParam?.trim()) {
    return NextResponse.json({ error: "Path wajib diisi" }, { status: 400 });
  }

  const path = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;
  if (path === "/") {
    return NextResponse.json(
      { error: "Hint hanya untuk subfolder, bukan root" },
      { status: 400 }
    );
  }

  const creds = await getUserBappenasCreds(session.user.id);
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "Kredensial Cloud Bappenas belum diisi. Lengkapi di Profil terlebih dahulu.",
        code: "NO_CREDS",
      },
      { status: 400 }
    );
  }

  try {
    const cached = await getCachedListing(session.user.id, path);
    let children;
    let listingCached = false;

    if (cached) {
      children = cached.entries;
      listingCached = true;
    } else {
      const listing = await fetchDirectoryListing(
        session.user.id,
        path,
        creds,
        { refresh: false }
      );
      children = listing.entries;
      listingCached = listing.listingCached;
    }

    const hint = summarizeCloudFolder(children);
    return NextResponse.json({ path, hint, listingCached });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal membaca folder cloud";
    console.error("[cloud/folder-hint]", message);
    return NextResponse.json(
      { path, hint: emptyCloudFolderHint(), error: message },
      { status: 502 }
    );
  }
}
