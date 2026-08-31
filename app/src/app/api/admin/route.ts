import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import {
  getAutoScanSettings,
  updateAutoScanSettings,
} from "@/lib/app-settings";

export async function GET() {
  const { error } = await requireAdminApi();
  if (error) return error;

  const [users, autoScan] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastSyncAt: true,
        bappenasUrl: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    getAutoScanSettings(),
  ]);

  return NextResponse.json({ users, settings: autoScan });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireAdminApi();
  if (error) return error;

  const body = await request.json();
  const { action } = body;

  if (action === "updateSettings") {
    const patch: {
      autoScanEnabled?: boolean;
      autoScanReady?: boolean;
      autoScanIntervalMinutes?: number;
      autoScanBatchSize?: number;
      autoScanRootPath?: string;
      autoScanSubtrees?: string;
      autoRetryEnabled?: boolean;
      autoRetryIntervalMinutes?: number;
      autoRetryBatchSize?: number;
    } = {};

    if (typeof body.autoScanEnabled === "boolean") {
      patch.autoScanEnabled = body.autoScanEnabled;
    }
    if (typeof body.autoScanReady === "boolean") {
      patch.autoScanReady = body.autoScanReady;
    }
    if (body.autoScanIntervalMinutes != null) {
      const n = Number(body.autoScanIntervalMinutes);
      if (!Number.isFinite(n) || n < 5) {
        return NextResponse.json(
          { error: "Interval minimal 5 menit" },
          { status: 400 }
        );
      }
      patch.autoScanIntervalMinutes = Math.floor(n);
    }
    if (body.autoScanBatchSize != null) {
      const n = Number(body.autoScanBatchSize);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json(
          { error: "Batch minimal 1 file" },
          { status: 400 }
        );
      }
      patch.autoScanBatchSize = Math.floor(n);
    }
    if (typeof body.autoScanRootPath === "string") {
      patch.autoScanRootPath = body.autoScanRootPath.trim() || "/";
    }
    if (typeof body.autoScanSubtrees === "string") {
      patch.autoScanSubtrees = body.autoScanSubtrees;
    }
    if (typeof body.autoRetryEnabled === "boolean") {
      patch.autoRetryEnabled = body.autoRetryEnabled;
    }
    if (body.autoRetryIntervalMinutes != null) {
      const n = Number(body.autoRetryIntervalMinutes);
      if (!Number.isFinite(n) || n < 15) {
        return NextResponse.json(
          { error: "Interval retry minimal 15 menit" },
          { status: 400 }
        );
      }
      patch.autoRetryIntervalMinutes = Math.floor(n);
    }
    if (body.autoRetryBatchSize != null) {
      const n = Number(body.autoRetryBatchSize);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json(
          { error: "Batch retry minimal 1 file" },
          { status: 400 }
        );
      }
      patch.autoRetryBatchSize = Math.floor(n);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
    }

    const settings = await updateAutoScanSettings(patch);
    await writeAudit("settings.auto_scan", session!.user.id, {
      ...patch,
    });
    return NextResponse.json({ settings });
  }

  if (action === "createUser") {
    const {
      email,
      name,
      password,
      role,
      bappenasUsername,
      bappenasPassword,
      bappenasUrl,
    } = body;

    if (!email || !name || !password || !bappenasUsername || !bappenasPassword) {
      return NextResponse.json(
        {
          error:
            "Email, nama, password, username & password Bappenas wajib diisi",
        },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email tidak valid" }, { status: 400 });
    }

    if (String(password).length < 8) {
      return NextResponse.json(
        { error: "Password minimal 8 karakter" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Email sudah terdaftar" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase().trim(),
        name: String(name).trim(),
        passwordHash,
        role: role === "ADMIN" ? Role.ADMIN : Role.USER,
        bappenasUrl:
          String(bappenasUrl || "").trim() || "https://cloud.bappenas.go.id",
        encryptedBappenasUsername: encrypt(String(bappenasUsername).trim()),
        encryptedBappenasPassword: encrypt(String(bappenasPassword)),
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await writeAudit("user.create", session!.user.id, { email });

    return NextResponse.json({ user });
  }

  if (action === "updateUser") {
    const {
      id,
      email,
      name,
      password,
      role,
      bappenasUsername,
      bappenasPassword,
      bappenasUrl,
    } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "ID user wajib" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
    }

    const data: {
      email?: string;
      name?: string;
      role?: Role;
      passwordHash?: string;
      bappenasUrl?: string;
      encryptedBappenasUsername?: string;
      encryptedBappenasPassword?: string;
    } = {};

    if (name && String(name).trim().length >= 2) {
      data.name = String(name).trim();
    }

    if (email) {
      const normalized = String(email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return NextResponse.json({ error: "Email tidak valid" }, { status: 400 });
      }
      if (normalized !== existing.email) {
        const dup = await prisma.user.findUnique({ where: { email: normalized } });
        if (dup) {
          return NextResponse.json(
            { error: "Email sudah dipakai user lain" },
            { status: 409 }
          );
        }
        data.email = normalized;
      }
    }

    if (role === "ADMIN" || role === "USER") {
      const nextRole = role === "ADMIN" ? Role.ADMIN : Role.USER;
      if (existing.role === Role.ADMIN && nextRole === Role.USER) {
        const adminCount = await prisma.user.count({
          where: { role: Role.ADMIN },
        });
        if (adminCount <= 1) {
          return NextResponse.json(
            { error: "Tidak bisa menurunkan admin terakhir" },
            { status: 400 }
          );
        }
      }
      data.role = nextRole;
    }

    if (password && String(password).length > 0) {
      if (String(password).length < 8) {
        return NextResponse.json(
          { error: "Password minimal 8 karakter" },
          { status: 400 }
        );
      }
      data.passwordHash = await bcrypt.hash(String(password), 12);
    }

    if (bappenasUrl && String(bappenasUrl).trim()) {
      data.bappenasUrl = String(bappenasUrl).trim();
    }

    if (bappenasUsername && bappenasPassword) {
      data.encryptedBappenasUsername = encrypt(String(bappenasUsername).trim());
      data.encryptedBappenasPassword = encrypt(String(bappenasPassword));
    } else if (bappenasUsername || bappenasPassword) {
      return NextResponse.json(
        {
          error:
            "Untuk update kredensial Bappenas, isi username dan password sekaligus",
        },
        { status: 400 }
      );
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        encryptedBappenasUsername: true,
      },
    });

    let hasBappenasCreds = false;
    try {
      const u = decrypt(user.encryptedBappenasUsername);
      hasBappenasCreds = !!u && u !== "admin-placeholder";
    } catch {
      hasBappenasCreds = false;
    }

    await writeAudit("user.update", session!.user.id, {
      targetUserId: id,
      fields: Object.keys(data),
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        hasBappenasCreds,
      },
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
