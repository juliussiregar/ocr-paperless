import { requireAdmin } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { AdminShellHeader } from "@/components/AdminShellHeader";
import { AdminNav } from "@/components/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <AppShell
      user={session.user}
      header={<AdminShellHeader />}
    >
      <div className="w-full flex-1 px-5 py-6 lg:px-8">
        <AdminNav />
        {children}
      </div>
    </AppShell>
  );
}
