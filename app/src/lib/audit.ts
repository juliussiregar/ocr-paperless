import { prisma } from "./prisma";

export async function writeAudit(
  action: string,
  userId?: string | null,
  meta?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: userId ?? null,
        meta: meta ? JSON.stringify(meta) : null,
      },
    });
  } catch (err) {
    console.error("[audit]", err);
  }
}
