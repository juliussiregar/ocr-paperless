import { prisma } from "./prisma";
import { incrementAiUsageFromMeta, isAiAuditAction } from "./ai-usage-aggregate";

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
    if (isAiAuditAction(action)) {
      await incrementAiUsageFromMeta(meta);
    }
  } catch (err) {
    console.error("[audit]", err);
  }
}
