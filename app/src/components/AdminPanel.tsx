"use client";

import { useState } from "react";
import { UserPlus, Users, Shield, Cloud } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";

interface AdminPanelProps {
  initialUsers: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: string;
    lastSyncAt: string | null;
  }>;
}

export function AdminPanel({ initialUsers }: AdminPanelProps) {
  const [users, setUsers] = useState(initialUsers);

  const [userForm, setUserForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "USER",
    bappenasUsername: "",
    bappenasPassword: "",
  });

  function showMsg(text: string, type: "success" | "error" = "success") {
    showToast(text, type);
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createUser", ...userForm }),
    });
    const data = await res.json();
    if (!res.ok) {
      showMsg(data.error ?? "Gagal membuat user", "error");
      return;
    }
    setUsers((prev) => [
      {
        ...data.user,
        createdAt: new Date().toISOString(),
        lastSyncAt: null,
      },
      ...prev,
    ]);
    setUserForm({
      email: "",
      name: "",
      password: "",
      role: "USER",
      bappenasUsername: "",
      bappenasPassword: "",
    });
    showMsg("User berhasil dibuat");
  }

  return (
    <div className="space-y-6">
      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
              <UserPlus size={18} />
            </div>
            <div>
              <h2 className="section-title">Tambah User</h2>
              <p className="text-xs text-slate-500">
                User juga bisa daftar sendiri di /register
              </p>
            </div>
          </div>
        </div>
        <form onSubmit={createUser} className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Nama
              </label>
              <input
                value={userForm.name}
                onChange={(e) =>
                  setUserForm((f) => ({ ...f, name: e.target.value }))
                }
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
                value={userForm.email}
                onChange={(e) =>
                  setUserForm((f) => ({ ...f, email: e.target.value }))
                }
                className="input-field"
                required
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Password aplikasi
              </label>
              <PasswordInput
                value={userForm.password}
                onChange={(e) =>
                  setUserForm((f) => ({ ...f, password: e.target.value }))
                }
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Role
              </label>
              <select
                value={userForm.role}
                onChange={(e) =>
                  setUserForm((f) => ({ ...f, role: e.target.value }))
                }
                className="input-field"
              >
                <option value="USER">User</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Cloud size={14} className="text-blue-600" />
              Kredensial Cloud Bappenas user
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Username Bappenas
                </label>
                <input
                  value={userForm.bappenasUsername}
                  onChange={(e) =>
                    setUserForm((f) => ({
                      ...f,
                      bappenasUsername: e.target.value,
                    }))
                  }
                  className="input-field"
                  required
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Password Bappenas
                </label>
                <PasswordInput
                  value={userForm.bappenasPassword}
                  onChange={(e) =>
                    setUserForm((f) => ({
                      ...f,
                      bappenasPassword: e.target.value,
                    }))
                  }
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>

          <button type="submit" className="btn btn-dark">
            Buat User
          </button>
        </form>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <Users size={18} />
            </div>
            <div>
              <h2 className="section-title">Daftar User</h2>
              <p className="text-xs text-slate-500">
                {users.length} user terdaftar
              </p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left">
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Nama
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Email
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Role
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Sync terakhir
                </th>
                <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Dibuat
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => (
                <tr key={u.id} className="transition hover:bg-slate-50/50">
                  <td className="px-6 py-3.5 font-medium text-slate-800">
                    {u.name}
                  </td>
                  <td className="px-6 py-3.5 text-slate-600">{u.email}</td>
                  <td className="px-6 py-3.5">
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
                  <td className="px-6 py-3.5 text-slate-500">
                    {u.lastSyncAt
                      ? new Date(u.lastSyncAt).toLocaleString("id-ID")
                      : "-"}
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString("id-ID")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
