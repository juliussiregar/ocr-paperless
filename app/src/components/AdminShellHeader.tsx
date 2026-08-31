"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/Nav";

const pages: Record<string, { title: string; description: string }> = {
  "/admin": {
    title: "Ringkasan admin",
    description: "Audit aktivitas, biaya OpenAI, dan pengaturan auto scan.",
  },
  "/admin/users": {
    title: "User management",
    description: "Kelola akun pengguna, role, dan kredensial Cloud Bappenas.",
  },
  "/admin/sync": {
    title: "Sync log",
    description:
      "Pipeline live, job aktif, tahapan discover sampai embed, tanpa refresh.",
  },
};

export function AdminShellHeader() {
  const pathname = usePathname();
  const meta =
    pages[pathname] ??
    (pathname.startsWith("/admin/sync")
      ? pages["/admin/sync"]
      : pathname.startsWith("/admin/users")
        ? pages["/admin/users"]
        : pages["/admin"]);

  return <PageHeader title={meta.title} description={meta.description} />;
}
