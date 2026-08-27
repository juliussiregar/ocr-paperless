"use client";

import { useMemo, useState } from "react";
import {
  Cloud,
  Pencil,
  Search,
  Shield,
  UserPlus,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  bappenasUrl: string | null;
  hasBappenasCreds: boolean;
  createdAt: string;
  lastSyncAt: string | null;
};

type UserFormState = {
  email: string;
  name: string;
  password: string;
  role: string;
  bappenasUrl: string;
  bappenasUsername: string;
  bappenasPassword: string;
};

const emptyForm = (): UserFormState => ({
  email: "",
  name: "",
  password: "",
  role: "USER",
  bappenasUrl: "https://cloud.bappenas.go.id",
  bappenasUsername: "",
  bappenasPassword: "",
});

interface AdminUsersPanelProps {
  initialUsers: AdminUser[];
}

export function AdminUsersPanel({ initialUsers }: AdminUsersPanelProps) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [createForm, setCreateForm] = useState<UserFormState>(emptyForm);
  const [editForm, setEditForm] = useState<UserFormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [users, query]);

  const stats = useMemo(
    () => ({
      total: users.length,
      admins: users.filter((u) => u.role === "ADMIN").length,
      cloudConnected: users.filter((u) => u.hasBappenasCreds).length,
    }),
    [users]
  );

  function showMsg(text: string, type: "success" | "error" = "success") {
    showToast(text, type);
  }

  function openEdit(user: AdminUser) {
    setEditUser(user);
    setEditForm({
      email: user.email,
      name: user.name,
      password: "",
      role: user.role,
      bappenasUrl: user.bappenasUrl || "https://cloud.bappenas.go.id",
      bappenasUsername: "",
      bappenasPassword: "",
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createUser", ...createForm }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal membuat user", "error");
        return;
      }
      setUsers((prev) => [
        {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          bappenasUrl: createForm.bappenasUrl,
          hasBappenasCreds: true,
          createdAt: new Date().toISOString(),
          lastSyncAt: null,
        },
        ...prev,
      ]);
      setCreateForm(emptyForm());
      setCreateOpen(false);
      showMsg("User berhasil dibuat");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        action: "updateUser",
        id: editUser.id,
        email: editForm.email,
        name: editForm.name,
        role: editForm.role,
        bappenasUrl: editForm.bappenasUrl,
      };
      if (editForm.password.trim()) payload.password = editForm.password;
      if (editForm.bappenasUsername.trim() || editForm.bappenasPassword.trim()) {
        payload.bappenasUsername = editForm.bappenasUsername;
        payload.bappenasPassword = editForm.bappenasPassword;
      }

      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error ?? "Gagal memperbarui user", "error");
        return;
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === editUser.id
            ? {
                ...u,
                email: data.user.email,
                name: data.user.name,
                role: data.user.role,
                bappenasUrl: editForm.bappenasUrl,
                hasBappenasCreds:
                  data.user.hasBappenasCreds ?? u.hasBappenasCreds,
              }
            : u
        )
      );
      setEditUser(null);
      showMsg("User diperbarui");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Total user", value: stats.total },
          { label: "Admin", value: stats.admins },
          { label: "Cloud terhubung", value: stats.cloudConnected },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {item.label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-800">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-800">{users.length}</span>{" "}
            user · buat dan edit lewat dialog
          </p>
          <button
            type="button"
            onClick={() => {
              setCreateForm(emptyForm());
              setCreateOpen(true);
            }}
            className="btn btn-dark inline-flex items-center gap-2"
          >
            <UserPlus size={16} />
            Tambah user
          </button>
        </div>

        <div className="border-b border-slate-100 px-6 py-3">
          <div className="relative max-w-md">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama, email, atau role…"
              className="input-field pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left">
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  User
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Role
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Cloud
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Sync terakhir
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Dibuat
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-10 text-center text-slate-500"
                  >
                    Tidak ada user yang cocok.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="transition hover:bg-slate-50/60">
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-800">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "badge",
                          u.role === "ADMIN" ? "badge-blue" : "badge-slate"
                        )}
                      >
                        {u.role === "ADMIN" && <Shield size={10} />}
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs font-medium",
                          u.hasBappenasCreds
                            ? "text-teal-700"
                            : "text-amber-700"
                        )}
                      >
                        <Cloud size={12} />
                        {u.hasBappenasCreds ? "Terhubung" : "Belum diisi"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {u.lastSyncAt
                        ? new Date(u.lastSyncAt).toLocaleString("id-ID")
                        : "-"}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString("id-ID")}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="Tambah user baru"
        description="User juga bisa mendaftar sendiri di halaman register."
        size="lg"
        closeOnBackdrop={!saving}
      >
        <UserFormFields
          form={createForm}
          setForm={setCreateForm}
          mode="create"
          saving={saving}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
        />
      </Dialog>

      <Dialog
        open={editUser != null}
        onClose={() => !saving && setEditUser(null)}
        title="Edit user"
        description={
          editUser
            ? `Perbarui profil dan akses untuk ${editUser.name}.`
            : undefined
        }
        size="lg"
        closeOnBackdrop={!saving}
      >
        {editUser && (
          <UserFormFields
            form={editForm}
            setForm={setEditForm}
            mode="edit"
            hasBappenasCreds={editUser.hasBappenasCreds}
            saving={saving}
            onSubmit={handleUpdate}
            onCancel={() => setEditUser(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function UserFormFields({
  form,
  setForm,
  mode,
  hasBappenasCreds,
  saving,
  onSubmit,
  onCancel,
}: {
  form: UserFormState;
  setForm: React.Dispatch<React.SetStateAction<UserFormState>>;
  mode: "create" | "edit";
  hasBappenasCreds?: boolean;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Nama
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input-field"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="input-field"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Password aplikasi
            {mode === "edit" && (
              <span className="ml-1 text-xs font-normal text-slate-400">
                (kosongkan jika tidak diubah)
              </span>
            )}
          </label>
          <PasswordInput
            value={form.password}
            onChange={(e) =>
              setForm((f) => ({ ...f, password: e.target.value }))
            }
            required={mode === "create"}
            minLength={mode === "create" ? 8 : undefined}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Role
          </label>
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="input-field"
          >
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Cloud size={14} className="text-blue-600" />
          Kredensial Cloud Bappenas
        </p>
        {mode === "edit" && hasBappenasCreds && (
          <p className="text-xs text-slate-500">
            Kredensial saat ini sudah tersimpan. Isi username dan password baru
            hanya jika ingin mengganti.
          </p>
        )}
        {mode === "edit" && !hasBappenasCreds && (
          <p className="text-xs text-amber-700">
            Cloud belum diisi. Lengkapi username dan password Bappenas agar user
            bisa membuka Library.
          </p>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            URL Cloud
          </label>
          <input
            value={form.bappenasUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, bappenasUrl: e.target.value }))
            }
            className="input-field"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Username Bappenas
            </label>
            <input
              value={form.bappenasUsername}
              onChange={(e) =>
                setForm((f) => ({ ...f, bappenasUsername: e.target.value }))
              }
              className="input-field"
              required={mode === "create"}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Password Bappenas
            </label>
            <PasswordInput
              value={form.bappenasPassword}
              onChange={(e) =>
                setForm((f) => ({ ...f, bappenasPassword: e.target.value }))
              }
              required={mode === "create"}
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="btn border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          disabled={saving}
        >
          Batal
        </button>
        <button type="submit" className="btn btn-dark" disabled={saving}>
          {saving
            ? "Menyimpan…"
            : mode === "create"
              ? "Buat user"
              : "Simpan perubahan"}
        </button>
      </div>
    </form>
  );
}
