/**
 * Production seed for Docker entrypoint (plain ESM, no tsx).
 * Idempotent upsert of the admin user from ADMIN_* env vars.
 */
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

// Resolve deps from the Next.js app install (Docker WORKDIR /app/app)
const require = createRequire("/app/app/package.json");
const { PrismaClient, Role } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function encrypt(text) {
  const key = createHash("sha256")
    .update(process.env.ENCRYPTION_KEY ?? "change-me-32-characters-min!!")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.log("ADMIN_EMAIL not set; skipping admin seed.");
    return;
  }

  const password = process.env.ADMIN_PASSWORD ?? "AdminOcr2026!";
  const name = process.env.ADMIN_NAME ?? "Administrator";

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const bappenasUser =
    process.env.BAPPENAS_USERNAME ||
    process.env.ADMIN_BAPPENAS_USERNAME ||
    "admin-placeholder";
  const bappenasPass =
    process.env.BAPPENAS_PASSWORD ||
    process.env.ADMIN_BAPPENAS_PASSWORD ||
    "change-me-bappenas";

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: Role.ADMIN,
    },
    create: {
      email,
      name,
      passwordHash,
      role: Role.ADMIN,
      bappenasUrl: process.env.BAPPENAS_URL ?? "https://cloud.bappenas.go.id",
      encryptedBappenasUsername: encrypt(bappenasUser),
      encryptedBappenasPassword: encrypt(bappenasPass),
    },
  });

  console.log(`Admin ready: ${user.email} (${user.role})`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
