export default function Loading() {
  return (
    <div className="app-shell flex min-h-screen w-full flex-col">
      <div className="h-14 w-full border-b border-[var(--auth-ink)]/10 bg-[var(--auth-paper)]" />
      <div className="flex-1 px-5 py-8 lg:px-8">
        <div className="h-8 w-48 animate-pulse bg-[var(--auth-ink)]/10" />
        <div className="mt-6 h-40 w-full animate-pulse bg-[var(--auth-ink)]/5" />
      </div>
    </div>
  );
}
