import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

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
