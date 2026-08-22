import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuthApi();
  if (error) return error;

  const userId = session!.user.id;
  const isAdmin = session!.user.role === "ADMIN";

  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = 30;

  const baseWhere = isAdmin ? {} : { userId };
  const where =
    status && Object.values(SyncStatus).includes(status as SyncStatus)
      ? { ...baseWhere, syncStatus: status as SyncStatus }
      : baseWhere;

  const jobWhere = isAdmin ? {} : { triggeredById: userId };

  const [total, files, stats, recentJobs] = await Promise.all([
    prisma.syncFile.count({ where }),
    prisma.syncFile.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        remotePath: true,
        fileName: true,
        syncStatus: true,
        paperlessDocumentId: true,
        errorMessage: true,
        fileSize: true,
        lastSyncedAt: true,
        updatedAt: true,
      },
    }),
    prisma.syncFile.groupBy({
      by: ["syncStatus"],
      where: baseWhere,
      _count: true,
    }),
    prisma.scanJob.findMany({
      where: jobWhere,
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        triggeredBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  const serialized = files.map((f) => ({
    ...f,
    fileSize: f.fileSize !== null ? Number(f.fileSize) : null,
  }));

  return NextResponse.json({
    files: serialized,
    total,
    page,
    pageSize,
    stats,
    recentJobs,
  });
}
