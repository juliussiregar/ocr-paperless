import { requireAuth } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { ProfileForm } from "@/components/ProfileForm";

export default async function AccountPage() {
  const session = await requireAuth();

  return (
    <AppShell user={session.user} fill>
      <div className="relative flex min-h-0 w-full flex-1 flex-col bg-[var(--auth-paper)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(ellipse 70% 40% at 70% -5%, rgb(11 110 99 / 0.08), transparent 55%)",
          }}
        />
        <div className="relative z-[1] mx-auto w-full max-w-3xl px-5 py-8 lg:px-8">
          <p className="auth-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-none tracking-[-0.03em] text-[var(--auth-ink)]">
            Akun
          </p>
          <p className="mt-2 max-w-lg text-sm text-[var(--auth-ink)]/50">
            Kelola profil dan kredensial Cloud Bappenas untuk sync dokumen.
          </p>
          <div className="mt-8">
            <ProfileForm />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
