import { prisma } from "@/lib/prisma";

/** Paperless document IDs belonging to this user's synced folders */
export async function getUserPaperlessDocIds(
  userId: string
): Promise<number[]> {
  const rows = await prisma.syncFile.findMany({
    where: {
      userId,
      paperlessDocumentId: { not: null },
    },
    select: { paperlessDocumentId: true },
  });

  return [
    ...new Set(
      rows
        .map((r) => r.paperlessDocumentId)
        .filter((id): id is number => id !== null)
    ),
  ];
}

export async function userOwnsPaperlessDoc(
  userId: string,
  paperlessDocumentId: number
): Promise<boolean> {
  const row = await prisma.syncFile.findFirst({
    where: { userId, paperlessDocumentId },
    select: { id: true },
  });
  return !!row;
}

export async function userHasBappenasCreds(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      encryptedBappenasUsername: true,
      encryptedBappenasPassword: true,
    },
  });
  if (!user?.encryptedBappenasUsername || !user.encryptedBappenasPassword) {
    return false;
  }
  // Seeded admin may still have placeholder: scan worker rejects it
  return true;
}
