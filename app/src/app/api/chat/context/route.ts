import { humanizeFileName } from "@/lib/display-name";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

/** Recent indexed docs for scope picker + dynamic Ask suggestions */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const files = await prisma.syncFile.findMany({
    where: {
      userId: session.user.id,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
    },
    orderBy: { lastSyncedAt: "desc" },
    take: 80,
    select: {
      fileName: true,
      remotePath: true,
      paperlessDocumentId: true,
      lastSyncedAt: true,
    },
  });

  const docs = files
    .filter((f) => f.paperlessDocumentId != null)
    .map((f) => ({
      id: f.paperlessDocumentId as number,
      fileName: f.fileName,
      remotePath: f.remotePath,
      displayName: humanizeFileName(f.fileName),
      lastSyncedAt: f.lastSyncedAt?.toISOString() ?? null,
    }));

  const folders = [
    ...new Set(
      docs
        .map((d) => {
          const parts = d.remotePath.split("/").filter(Boolean);
          if (parts.length < 2) return "/";
          return "/" + parts.slice(0, -1).join("/");
        })
        .filter(Boolean)
    ),
  ].slice(0, 20);

  // Smarter suggestions: mix newest + mid-list variety, dedupe by display name
  const suggestions: Array<{ id: number; text: string }> = [];
  const seen = new Set<string>();
  const pick = (d: (typeof docs)[0], prefix: string) => {
    const label = d.displayName;
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ id: d.id, text: `${prefix}${label}` });
  };

  for (const d of docs.slice(0, 3)) pick(d, "Ringkas isi: ");
  // Variety from older half of recent window
  const mid = docs.slice(Math.floor(docs.length / 3));
  for (const d of mid.slice(0, 4)) {
    if (suggestions.length >= 4) break;
    pick(d, "Apa poin penting di: ");
  }
  for (const d of docs) {
    if (suggestions.length >= 4) break;
    pick(d, "Ringkas isi: ");
  }

  return NextResponse.json({
    docs: docs.slice(0, 40),
    folders,
    suggestions: suggestions.slice(0, 4),
  });
}
