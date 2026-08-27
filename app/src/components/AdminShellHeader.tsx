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
};

export function AdminShellHeader() {
  const pathname = usePathname();
  const meta =
    pages[pathname] ??
    (pathname.startsWith("/admin/users")
      ? pages["/admin/users"]
      : pages["/admin"]);

  return <PageHeader title={meta.title} description={meta.description} />;
}
