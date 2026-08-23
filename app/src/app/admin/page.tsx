import { requireAdmin } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/Nav";
import { AdminPanel } from "@/components/AdminPanel";
import { prisma } from "@/lib/prisma";
import { getAutoScanSettings } from "@/lib/app-settings";

export default async function AdminPage() {
  const session = await requireAdmin();

  const [users, settings] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastSyncAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    getAutoScanSettings(),
  ]);

  return (
    <AppShell
      user={session.user}
      header={
        <PageHeader
          title="Admin"
          description="Audit aktivitas, biaya OpenAI, user, dan pengaturan organisasi."
        />
      }
    >
      <div className="w-full flex-1 px-5 py-6 lg:px-8">
        <AdminPanel
          initialUsers={users.map((u) => ({
            ...u,
            role: u.role,
            createdAt: u.createdAt.toISOString(),
            lastSyncAt: u.lastSyncAt?.toISOString() ?? null,
          }))}
          initialSettings={settings}
        />
      </div>
    </AppShell>
  );
}
