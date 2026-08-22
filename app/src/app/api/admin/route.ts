import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import {
  getAutoScanSettings,
  setAutoScanEnabled,
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
    if (typeof body.autoScanEnabled !== "boolean") {
      return NextResponse.json(
        { error: "autoScanEnabled harus boolean" },
        { status: 400 }
      );
    }
    await setAutoScanEnabled(body.autoScanEnabled);
    await writeAudit("settings.auto_scan", session!.user.id, {
      autoScanEnabled: body.autoScanEnabled,
      intervalMinutes: 60,
    });
    const settings = await getAutoScanSettings();
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

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
