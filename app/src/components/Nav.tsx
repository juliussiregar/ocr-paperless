"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Search,
  MessageSquareText,
  Library,
  UserCircle,
  Settings,
  LogOut,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ASK_PRODUCT_NAME } from "@/lib/product-copy";

interface NavProps {
  user: { name?: string | null; email?: string | null; role?: string };
}

export function Nav({ user }: NavProps) {
  const pathname = usePathname();

  const links = [
    { href: "/", label: ASK_PRODUCT_NAME, icon: MessageSquareText },
    { href: "/search", label: "Pencarian", icon: Search },
    { href: "/cloud", label: "Library", icon: Library },
    { href: "/profile", label: "Akun", icon: UserCircle },
    ...(user.role === "ADMIN"
      ? [
          { href: "/admin", label: "Admin", icon: Settings },
          { href: "/admin/sync", label: "Sync log", icon: Radio },
        ]
      : []),
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/" || pathname === "/ask";
    if (href === "/admin/sync") {
      return pathname === "/admin/sync" || pathname.startsWith("/admin/sync/");
    }
    if (href === "/admin") {
      return (
        pathname === "/admin" ||
        (pathname.startsWith("/admin/") && !pathname.startsWith("/admin/sync"))
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="app-nav sticky top-0 z-50 w-full border-b border-[var(--auth-ink)]/10 bg-[var(--auth-paper)]/95 backdrop-blur-md">
      <div className="flex w-full items-center justify-between gap-4 px-5 py-3 lg:px-8">
        <div className="flex min-w-0 items-center gap-6 lg:gap-10">
          <Link href="/" className="shrink-0 group">
            <span className="auth-display text-lg font-bold tracking-[-0.03em] text-[var(--auth-ink)] sm:text-xl">
              Doc
              <span className="text-[var(--auth-teal)]">Search</span>
            </span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--auth-ink)]/45">
              Bappenas
            </span>
          </Link>

          <nav className="flex items-center gap-0.5 overflow-x-auto">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
                  isActive(href)
                    ? "border-[var(--auth-teal)] text-[var(--auth-ink)]"
                    : "border-transparent text-[var(--auth-ink)]/50 hover:text-[var(--auth-ink)]"
                )}
              >
                <Icon size={15} strokeWidth={2} />
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-[var(--auth-ink)]">
              {user.name ?? "User"}
            </p>
            <p className="text-[11px] uppercase tracking-wider text-[var(--auth-ink)]/40">
              {user.role}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center gap-2 border border-[var(--auth-ink)]/15 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--auth-ink)] transition hover:border-[var(--auth-ink)] hover:bg-[var(--auth-ink)] hover:text-white"
            title="Keluar"
          >
            <LogOut size={14} />
            <span className="hidden lg:inline">Keluar</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-end justify-between gap-4 border-b border-[var(--auth-ink)]/10 px-5 py-6 lg:px-8">
      <div>
        <h1 className="auth-display text-2xl font-bold tracking-[-0.03em] text-[var(--auth-ink)] sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--auth-ink)]/55">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
