import { PrismaClient } from "@prisma/client";
import { prismaDatabaseUrl } from "./prisma-url.js";

/** Default pool small: Paperless + app share the same Postgres (max_connections). */
const datasourceUrl = prismaDatabaseUrl(process.env.DATABASE_URL, 12);

export const prisma = new PrismaClient(
  datasourceUrl
    ? { datasources: { db: { url: datasourceUrl } } }
    : undefined
);

export async function getUserCloudCredentials(userId: string): Promise<{
  url: string;
  username: string;
  password: string;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      bappenasUrl: true,
      encryptedBappenasUsername: true,
      encryptedBappenasPassword: true,
    },
  });

  if (!user?.encryptedBappenasUsername || !user.encryptedBappenasPassword) {
    return null;
  }

  const { decrypt } = await import("./crypto.js");
  const username = decrypt(user.encryptedBappenasUsername);
  const password = decrypt(user.encryptedBappenasPassword);

  if (!username || username === "admin-placeholder") {
    return null;
  }

  return {
    url: user.bappenasUrl || "https://cloud.bappenas.go.id",
    username,
    password,
  };
}
