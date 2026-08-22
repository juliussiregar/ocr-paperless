import { requireAuth } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { CloudBrowser } from "@/components/CloudBrowser";

export default async function LibraryPage() {
  const session = await requireAuth();

  return (
    <AppShell user={session.user}>
      <CloudBrowser />
    </AppShell>
  );
}
