import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      name: true,
      bappenasUrl: true,
      encryptedBappenasUsername: true,
      lastSyncAt: true,
      lastDiscoveryAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let bappenasUsernameMasked = "";
  try {
    const u = decrypt(user.encryptedBappenasUsername);
    if (u && u !== "admin-placeholder") {
      bappenasUsernameMasked =
        u.length <= 3 ? "***" : `${u.slice(0, 2)}${"*".repeat(Math.min(u.length - 2, 6))}`;
    }
  } catch {
    bappenasUsernameMasked = "";
  }

  return NextResponse.json({
    email: user.email,
    name: user.name,
    bappenasUrl: user.bappenasUrl,
    bappenasUsernameMasked,
    hasBappenasCreds: !!bappenasUsernameMasked,
    lastSyncAt: user.lastSyncAt,
    lastDiscoveryAt: user.lastDiscoveryAt,
  });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, bappenasUrl, bappenasUsername, bappenasPassword } = body;

  const data: {
    name?: string;
    bappenasUrl?: string;
    encryptedBappenasUsername?: string;
    encryptedBappenasPassword?: string;
  } = {};

  if (name && String(name).trim().length >= 2) {
    data.name = String(name).trim();
  }

  if (bappenasUrl) {
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

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  await writeAudit("user.profile.update", session.user.id, {
    fields: Object.keys(data),
  });

  return NextResponse.json({ ok: true });
}
