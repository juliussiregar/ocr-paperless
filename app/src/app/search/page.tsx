import { Suspense } from "react";
import { requireAuth } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { SearchWorkspace } from "@/components/SearchWorkspace";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

export default async function SearchPage() {
  const session = await requireAuth();
  const userId = session.user.id;

  const documentCount = await prisma.syncFile.count({
    where: {
      userId,
      syncStatus: { in: [SyncStatus.OCR_DONE, SyncStatus.SKIPPED] },
    },
  });

  return (
    <AppShell user={session.user} fill>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--auth-ink)]/40">
            Memuat Search…
          </div>
        }
      >
        <SearchWorkspace documentCount={documentCount} />
      </Suspense>
    </AppShell>
  );
}
