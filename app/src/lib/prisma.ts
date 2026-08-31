import { PrismaClient } from "@prisma/client";
import { prismaDatabaseUrl } from "@/lib/prisma-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Keep app pool modest; live poll + API share one client. */
function createPrismaClient() {
  const datasourceUrl = prismaDatabaseUrl(process.env.DATABASE_URL, 8);
  return new PrismaClient({
    ...(datasourceUrl
      ? { datasources: { db: { url: datasourceUrl } } }
      : {}),
    log:
      process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  // After `prisma generate`, HMR can keep a stale client without new models.
  if (
    existing &&
    typeof (existing as { chatConversation?: unknown }).chatConversation !==
      "undefined"
  ) {
    return existing;
  }
  if (existing) {
    void existing.$disconnect().catch(() => undefined);
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrisma();
