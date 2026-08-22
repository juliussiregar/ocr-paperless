import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";

export async function POST(request: NextRequest) {
  const rl = rateLimit("register", 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak request. Coba lagi dalam ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = await request.json();
  const {
    email,
    name,
    password,
    bappenasUsername,
    bappenasPassword,
    bappenasUrl,
  } = body;

  if (!email || !name || !password || !bappenasUsername || !bappenasPassword) {
    return NextResponse.json(
      {
        error:
          "Email, nama, password aplikasi, username & password Bappenas wajib diisi",
      },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return NextResponse.json({ error: "Email tidak valid" }, { status: 400 });
  }

  if (String(password).length < 8) {
    return NextResponse.json(
      { error: "Password aplikasi minimal 8 karakter" },
      { status: 400 }
    );
  }

  if (String(name).trim().length < 2) {
    return NextResponse.json({ error: "Nama terlalu pendek" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { email: String(email).toLowerCase().trim() },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Email sudah terdaftar" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(String(password), 12);

  const user = await prisma.user.create({
    data: {
      email: String(email).toLowerCase().trim(),
      name: String(name).trim(),
      passwordHash,
      role: Role.USER,
      bappenasUrl:
        String(bappenasUrl || "").trim() || "https://cloud.bappenas.go.id",
      encryptedBappenasUsername: encrypt(String(bappenasUsername).trim()),
      encryptedBappenasPassword: encrypt(String(bappenasPassword)),
    },
    select: { id: true, email: true, name: true },
  });

  await writeAudit("user.register", user.id, { email: user.email });

  return NextResponse.json({
    ok: true,
    user: { email: user.email, name: user.name },
  });
}
