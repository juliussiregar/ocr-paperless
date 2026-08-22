import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

export type ChatScope =
  | { mode: "all" }
  | { mode: "docs"; docIds: number[] }
  | { mode: "folder"; pathPrefix: string };

export function parseScope(raw: string | null | undefined): ChatScope {
  try {
    const parsed = JSON.parse(raw || '{"mode":"all"}') as ChatScope;
    if (parsed?.mode === "docs" && Array.isArray(parsed.docIds)) return parsed;
    if (parsed?.mode === "folder" && typeof parsed.pathPrefix === "string") {
      return parsed;
    }
    return { mode: "all" };
  } catch {
    return { mode: "all" };
  }
}

export function serializeScope(scope: ChatScope): string {
  return JSON.stringify(scope);
}

/** Resolve Paperless doc IDs allowed for this user + scope. */
export async function resolveScopedDocIds(
  userId: string,
  scope: ChatScope
): Promise<number[]> {
  if (scope.mode === "docs") {
    const rows = await prisma.syncFile.findMany({
      where: {
        userId,
        paperlessDocumentId: { in: scope.docIds },
        syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      },
      select: { paperlessDocumentId: true },
    });
    return rows
      .map((r) => r.paperlessDocumentId)
      .filter((id): id is number => id != null);
  }

  if (scope.mode === "folder") {
    const prefix = scope.pathPrefix.endsWith("/")
      ? scope.pathPrefix
      : `${scope.pathPrefix}/`;
    const rows = await prisma.syncFile.findMany({
      where: {
        userId,
        syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
        paperlessDocumentId: { not: null },
        OR: [
          { remotePath: { startsWith: prefix } },
          { remotePath: scope.pathPrefix },
        ],
      },
      select: { paperlessDocumentId: true },
    });
    return [
      ...new Set(
        rows
          .map((r) => r.paperlessDocumentId)
          .filter((id): id is number => id != null)
      ),
    ];
  }

  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
      paperlessDocumentId: { not: null },
    },
    select: { paperlessDocumentId: true },
  });
  return [
    ...new Set(
      rows
        .map((r) => r.paperlessDocumentId)
        .filter((id): id is number => id != null)
    ),
  ];
}
