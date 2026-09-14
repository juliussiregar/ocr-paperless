import { Suspense } from "react";
import { requireAuth } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { AskWorkspace } from "@/components/AskWorkspace";
import { prisma } from "@/lib/prisma";
import { SyncStatus } from "@prisma/client";

export default async function AskHomePage() {
  const session = await requireAuth();
  const userId = session.user.id;

  const documentCount = await prisma.syncFile.count({
    where: { userId, syncStatus: SyncStatus.OCR_DONE },
  });

  return (
    <AppShell user={session.user} fill>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--auth-ink)]/40">
            Memuat Tanya Arsip…
          </div>
        }
      >
        <AskWorkspace documentCount={documentCount} />
      </Suspense>
    </AppShell>
  );
}
