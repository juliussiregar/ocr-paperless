import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { getUserBappenasCreds } from "@/lib/bappenas";
import {
  retryFailedFilesForUser,
  retryPathsForUser,
} from "@/lib/retry-failed-sync";

/** Retry failed sync files (manual re-queue for ingest). */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const rl = rateLimit(`cloud-retry:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
        { status: 429 }
      );
    }

    const creds = await getUserBappenasCreds(userId);
    if (!creds) {
      return NextResponse.json(
        { error: "Kredensial Cloud Bappenas belum diisi.", code: "NO_CREDS" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const allFailed = body.allFailed === true;
    const rawPaths: unknown[] = Array.isArray(body.paths) ? body.paths : [];

    const result = allFailed
      ? await retryFailedFilesForUser(userId)
      : await retryPathsForUser(
          userId,
          rawPaths.filter((p): p is string => typeof p === "string")
        );

    await writeAudit("cloud.retry", userId, {
      jobId: result.jobId,
      count: result.totalFiles,
      allFailed,
    });

    return NextResponse.json({
      jobId: result.jobId,
      status: "PENDING",
      totalFiles: result.totalFiles,
      maxFiles: result.maxFiles,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal mengulang file gagal";
    const status =
      message.startsWith("Job aktif") || message.includes("Tidak ada file")
        ? message.startsWith("Job aktif")
          ? 409
          : 400
        : 500;
    console.error("[cloud/retry]", err);
    return NextResponse.json({ error: message }, { status });
  }
}
