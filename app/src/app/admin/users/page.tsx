import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      lastSyncAt: true,
      bappenasUrl: true,
      encryptedBappenasUsername: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AdminUsersPanel
      initialUsers={users.map((u) => {
        let hasBappenasCreds = false;
        try {
          const username = decrypt(u.encryptedBappenasUsername);
          hasBappenasCreds = !!username && username !== "admin-placeholder";
        } catch {
          hasBappenasCreds = false;
        }
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          bappenasUrl: u.bappenasUrl,
          hasBappenasCreds,
          createdAt: u.createdAt.toISOString(),
          lastSyncAt: u.lastSyncAt?.toISOString() ?? null,
        };
      })}
    />
  );
}
