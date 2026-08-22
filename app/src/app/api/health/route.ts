import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProductionSecrets } from "@/lib/env";

export async function GET() {
  const checks: Record<string, string | boolean> = {
    app: true,
    database: false,
    paperless: false,
    openai: !!process.env.OPENAI_API_KEY?.startsWith("sk-"),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const paperlessUrl = process.env.PAPERLESS_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${paperlessUrl}/api/`, {
      signal: AbortSignal.timeout(4000),
    });
    checks.paperless = res.ok || res.status === 401 || res.status === 403;
  } catch {
    checks.paperless = false;
  }

  const secretWarnings = assertProductionSecrets();
  const ok = checks.database === true;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks,
      warnings: secretWarnings,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
