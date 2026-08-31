"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Radio, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  {
    href: "/admin",
    label: "Ringkasan",
    icon: BarChart3,
    exact: true,
  },
  {
    href: "/admin/users",
    label: "User",
    icon: Users,
    exact: false,
  },
  {
    href: "/admin/sync",
    label: "Sync log",
    icon: Radio,
    exact: false,
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-slate-100 pb-4">
      {tabs.map(({ href, label, icon: Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
              active
                ? "bg-teal-600 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
