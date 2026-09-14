"use client";

import Link from "next/link";
import { type ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  /** Short EN eyebrow under brand */
  eyebrow: string;
  /** Supporting line under brand (one sentence) */
  support: string;
  footerNote?: string;
};

/**
 * Shared auth surface: white / ink / deep teal, brand-first, index-grid atmosphere.
 */
export function AuthShell({
  children,
  eyebrow,
  support,
  footerNote = "Penggunaan internal · Cloud Bappenas",
}: AuthShellProps) {
  return (
    <div className="auth-surface relative flex min-h-screen flex-col overflow-hidden">
      <div className="auth-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="auth-ink-wash pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10 sm:px-10 sm:py-14">
        <header className="auth-enter">
          <Link href="/login" className="group inline-block focus:outline-none">
            <p className="auth-display text-[clamp(2.75rem,9vw,5.5rem)] font-bold leading-[0.9] tracking-[-0.04em] text-[var(--auth-ink)]">
              Doc
              <span className="text-[var(--auth-teal)]">Search</span>
            </p>
            <p className="auth-display mt-2 text-sm font-semibold uppercase tracking-[0.28em] text-[var(--auth-ink)]/55 sm:text-base">
              Bappenas
            </p>
          </Link>
          <div className="mt-6 flex max-w-md items-start gap-3">
            <span className="mt-1.5 h-8 w-1 shrink-0 bg-[var(--auth-teal)] auth-bar" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--auth-teal)]">
                {eyebrow}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--auth-ink)]/65 sm:text-[15px]">
                {support}
              </p>
            </div>
          </div>
        </header>

        <main className="auth-enter-delay mt-10 flex-1 sm:mt-14">
          <div className="auth-panel mx-auto w-full max-w-md">{children}</div>
        </main>

        <footer className="auth-enter-delay-2 mt-12 border-t border-[var(--auth-ink)]/10 pt-5 text-[11px] tracking-wide text-[var(--auth-ink)]/40">
          {footerNote}
        </footer>
      </div>
    </div>
  );
}
