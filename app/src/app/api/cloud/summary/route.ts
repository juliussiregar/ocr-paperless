import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildTrackedSummary,
  getLiveSummaryCache,
  isLiveScanInProgress,
  refreshLiveSummary,
} from "@/lib/cloud-sync-summary";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  const tracked = await buildTrackedSummary(userId);

  if (refresh) {
    const rl = rateLimit(`cloud-summary-refresh:${userId}`, 3, 120_000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Refresh terlalu sering. Coba lagi dalam ${rl.retryAfterSec}s`,
        },
        { status: 429 }
      );
    }

    try {
      const { live, liveRefreshing } = await refreshLiveSummary(userId);
      let notTrackedEstimate: number | null = null;
      let notTrackedIsPartial = false;
      if (live) {
        notTrackedEstimate = Math.max(0, live.documentCount - tracked.detected);
        notTrackedIsPartial = live.truncated;
      }
      return NextResponse.json({
        tracked,
        live,
        notTrackedEstimate,
        notTrackedIsPartial,
        liveStatus: liveRefreshing ? "refreshing" : "cached",
        liveRefreshing,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal scan cloud live";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const live = await getLiveSummaryCache(userId);
  const liveRefreshing = await isLiveScanInProgress(userId);

  let notTrackedEstimate: number | null = null;
  let notTrackedIsPartial = false;
  if (live) {
    notTrackedEstimate = Math.max(0, live.documentCount - tracked.detected);
    notTrackedIsPartial = live.truncated;
  }

  return NextResponse.json({
    tracked,
    live,
    notTrackedEstimate,
    notTrackedIsPartial,
    liveStatus: live
      ? liveRefreshing
        ? "refreshing"
        : "cached"
      : liveRefreshing
        ? "refreshing"
        : "missing",
    liveRefreshing,
  });
}
