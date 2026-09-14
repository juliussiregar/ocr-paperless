"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/ui/PasswordInput";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      remember: remember ? "true" : "false",
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email atau password salah");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell
      eyebrow="Masuk"
      support="Masuk untuk mencari dan menanyakan isi PDF dari Cloud Bappenas (OCR, pencarian, arsip)."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {registered && (
          <div className="auth-alert auth-alert-ok" role="status">
            Akun berhasil dibuat. Silakan masuk.
          </div>
        )}
        {error && (
          <div className="auth-alert auth-alert-error" role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="login-email" className="auth-label">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
            placeholder="nama@organisasi.go.id"
            required
            autoComplete="email"
          />
        </div>

        <div>
          <label htmlFor="login-password" className="auth-label">
            Password
          </label>
          <PasswordInput
            id="login-password"
            variant="auth"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
        </div>

        <label className="auth-remember flex cursor-pointer items-center gap-2.5 select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="auth-checkbox"
          />
          <span className="text-sm text-[var(--auth-ink)]/70">
            Ingat saya
            <span className="mt-0.5 block text-[11px] text-[var(--auth-ink)]/40">
              {remember
                ? "Tetap masuk hingga 30 hari"
                : "Sesi berakhir dalam 8 jam"}
            </span>
          </span>
        </label>

        <button type="submit" disabled={loading} className="auth-btn">
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={16} />
              Memproses…
            </>
          ) : (
            <>
              Masuk
              <ArrowRight size={16} strokeWidth={2.5} />
            </>
          )}
        </button>

        <p className="text-center text-sm text-[var(--auth-ink)]/50">
          Belum punya akun?{" "}
          <Link href="/register" className="auth-link">
            Daftar
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-surface flex min-h-screen items-center justify-center">
          <Loader2 className="animate-spin text-[var(--auth-teal)]" size={24} />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
