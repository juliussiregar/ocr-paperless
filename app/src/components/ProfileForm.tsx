"use client";

import { useEffect, useState } from "react";
import { Loader2, Cloud, Link2, CheckCircle2, AlertCircle } from "lucide-react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { showToast } from "@/components/Toast";
import { cn } from "@/lib/utils";

export function ProfileForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<{
    email: string;
    name: string;
    bappenasUrl: string;
    bappenasUsernameMasked: string;
    hasBappenasCreds: boolean;
    lastSyncAt: string | null;
  } | null>(null);

  const [form, setForm] = useState({
    name: "",
    bappenasUrl: "https://cloud.bappenas.go.id",
    bappenasUsername: "",
    bappenasPassword: "",
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        setProfile(data);
        setForm((f) => ({
          ...f,
          name: data.name ?? "",
          bappenasUrl: data.bappenasUrl ?? f.bappenasUrl,
        }));
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const body: Record<string, string> = {
      name: form.name,
      bappenasUrl: form.bappenasUrl,
    };
    if (form.bappenasUsername && form.bappenasPassword) {
      body.bappenasUsername = form.bappenasUsername;
      body.bappenasPassword = form.bappenasPassword;
    }

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      showToast(data.error ?? "Gagal menyimpan", "error");
      return;
    }

    showToast("Profil berhasil diperbarui");
    setForm((f) => ({ ...f, bappenasUsername: "", bappenasPassword: "" }));
    const refreshed = await fetch("/api/profile").then((r) => r.json());
    setProfile(refreshed);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-[var(--auth-teal)]" size={24} />
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mx-auto w-full max-w-xl space-y-10">
      <section>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
          Profil
        </p>
        <label className="mb-1.5 block text-[13px] font-medium text-[var(--auth-ink)]/70">
          Nama
        </label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="input-field"
          required
        />
        <p className="mt-2 text-[12px] text-[var(--auth-ink)]/40">
          {profile?.email}
        </p>
      </section>

      <section className="border-t border-[var(--auth-ink)]/[0.06] pt-8">
        <div className="mb-1 flex items-center gap-2">
          <Cloud size={15} className="text-[var(--auth-teal)]" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
            Cloud Bappenas
          </p>
        </div>
        <p className="mb-4 text-[13px] text-[var(--auth-ink)]/50">
          Kredensial dipakai untuk browse Library dan ambil PDF. Disimpan
          terenkripsi.
        </p>

        <div
          className={cn(
            "mb-5 flex items-start gap-2.5 border-l-2 py-1 pl-3 text-[13px]",
            profile?.hasBappenasCreds
              ? "border-[var(--auth-teal)] text-[var(--auth-ink)]/60"
              : "border-amber-600 text-amber-800"
          )}
        >
          {profile?.hasBappenasCreds ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--auth-teal)]" />
          ) : (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          )}
          <span>
            {profile?.hasBappenasCreds
              ? `Username tersimpan: ${profile.bappenasUsernameMasked}`
              : "Belum diisi. Scan dan Library tidak bisa jalan sampai kredensial disimpan."}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--auth-ink)]/70">
              <Link2 size={13} />
              URL
            </label>
            <input
              value={form.bappenasUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, bappenasUrl: e.target.value }))
              }
              className="input-field"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--auth-ink)]/70">
              Username (isi ulang untuk ganti)
            </label>
            <input
              value={form.bappenasUsername}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  bappenasUsername: e.target.value,
                }))
              }
              className="input-field"
              autoComplete="off"
              placeholder={profile?.bappenasUsernameMasked || "username"}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--auth-ink)]/70">
              Password (isi ulang untuk ganti)
            </label>
            <PasswordInput
              value={form.bappenasPassword}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  bappenasPassword: e.target.value,
                }))
              }
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </div>
        </div>

        {profile?.lastSyncAt && (
          <p className="mt-4 text-[12px] text-[var(--auth-ink)]/35">
            Sync terakhir:{" "}
            {new Date(profile.lastSyncAt).toLocaleString("id-ID")}
          </p>
        )}
      </section>

      <button type="submit" disabled={saving} className="btn btn-primary">
        {saving ? (
          <>
            <Loader2 className="animate-spin" size={16} />
            Menyimpan...
          </>
        ) : (
          "Simpan perubahan"
        )}
      </button>
    </form>
  );
}
