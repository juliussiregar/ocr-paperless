"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    bappenasUsername: "",
    bappenasPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Registrasi gagal");
      return;
    }

    router.push("/login?registered=1");
  }

  return (
    <AuthShell
      eyebrow="Create account"
      support="Satu akun DocSearch + kredensial Cloud Bappenas Anda (disimpan terenkripsi)."
    >
      <form onSubmit={handleSubmit} className="space-y-7">
        {error && (
          <div className="auth-alert auth-alert-error" role="alert">
            {error}
          </div>
        )}

        <section className="space-y-5">
          <h2 className="auth-section-title">App account</h2>

          <div>
            <label htmlFor="reg-name" className="auth-label">
              Name
            </label>
            <input
              id="reg-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="auth-input"
              required
              autoComplete="name"
            />
          </div>

          <div>
            <label htmlFor="reg-email" className="auth-label">
              Email
            </label>
            <input
              id="reg-email"
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              className="auth-input"
              placeholder="nama@organisasi.go.id"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="reg-password" className="auth-label">
              App password
            </label>
            <PasswordInput
              id="reg-password"
              variant="auth"
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
              placeholder="Min. 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
        </section>

        <section className="space-y-5 border-t border-[var(--auth-ink)]/10 pt-8">
          <div>
            <h2 className="auth-section-title">Cloud Bappenas</h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--auth-ink)]/45">
              Username & password untuk cloud.bappenas.go.id, dipakai sync
              folder milik Anda.
            </p>
          </div>

          <div>
            <label htmlFor="reg-bappenas-user" className="auth-label">
              Bappenas username
            </label>
            <input
              id="reg-bappenas-user"
              value={form.bappenasUsername}
              onChange={(e) =>
                setForm((f) => ({ ...f, bappenasUsername: e.target.value }))
              }
              className="auth-input"
              required
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="reg-bappenas-pass" className="auth-label">
              Bappenas password
            </label>
            <PasswordInput
              id="reg-bappenas-pass"
              variant="auth"
              value={form.bappenasPassword}
              onChange={(e) =>
                setForm((f) => ({ ...f, bappenasPassword: e.target.value }))
              }
              required
              autoComplete="new-password"
            />
          </div>
        </section>

        <button type="submit" disabled={loading} className="auth-btn">
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={16} />
              Creating…
            </>
          ) : (
            <>
              Create account
              <ArrowRight size={16} strokeWidth={2.5} />
            </>
          )}
        </button>

        <p className="text-center text-sm text-[var(--auth-ink)]/50">
          Already have an account?{" "}
          <Link href="/login" className="auth-link">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
