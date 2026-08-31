import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProductionSecrets } from "@/lib/env";
import { getRedis } from "@/lib/queue";

export async function GET() {
  const checks: Record<string, string | boolean> = {
    app: true,
    database: false,
    redis: false,
    paperless: false,
    openai: !!process.env.OPENAI_API_KEY?.startsWith("sk-"),
    paperlessToken: !!(
      process.env.PAPERLESS_TOKEN?.trim() ||
      process.env.PAPERLESS_API_TOKEN?.trim()
    ),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    const pong = await getRedis().ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
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
  const ok =
    checks.database === true && checks.redis === true;

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
