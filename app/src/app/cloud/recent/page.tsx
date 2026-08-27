import { requireAuth } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { RecentScansList } from "@/components/RecentScansList";

export default async function RecentScansPage() {
  const session = await requireAuth();

  return (
    <AppShell user={session.user}>
      <RecentScansList />
    </AppShell>
  );
}
