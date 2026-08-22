import { Nav } from "@/components/Nav";

type AppShellProps = {
  user: { name?: string | null; email?: string | null; role?: string };
  children: React.ReactNode;
  /** Optional top page chrome (title row). Content below is full-bleed. */
  header?: React.ReactNode;
  /** Lock to viewport height (Ask chat). Other pages scroll normally. */
  fill?: boolean;
};

/**
 * Authenticated app frame: full viewport width, auth design tokens.
 */
export function AppShell({ user, children, header, fill = false }: AppShellProps) {
  return (
    <div
      className={
        fill
          ? "app-shell flex h-dvh max-h-dvh w-full flex-col overflow-hidden"
          : "app-shell flex min-h-screen w-full flex-col"
      }
    >
      <Nav user={user} />
      {header}
      <main
        className={
          fill
            ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden"
            : "flex w-full flex-1 flex-col"
        }
      >
        {children}
      </main>
      {!fill && (
        <footer className="mt-auto w-full border-t border-[var(--auth-ink)]/10 px-5 py-4 lg:px-8">
          <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[11px] tracking-wide text-[var(--auth-ink)]/40">
            <span>DocSearch Bappenas · Internal use</span>
            <span>Ask AI · Search · Library</span>
          </div>
        </footer>
      )}
    </div>
  );
}
