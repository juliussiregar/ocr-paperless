import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdminApi } from "@/lib/session";
import {
  loadGoldenCases,
  runAskEval,
  saveGoldenCases,
  type AskGoldenCase,
} from "@/lib/ask-eval";
import { resolveScopedDocIds, parseScope } from "@/lib/chat-scope";

export async function GET() {
  const { error, session } = await requireAdminApi();
  if (error) return error;

  const cases = await loadGoldenCases();
  return NextResponse.json({ cases, adminUserId: session!.user!.id });
}

export async function PUT(request: NextRequest) {
  const { error } = await requireAdminApi();
  if (error) return error;

  const body = await request.json();
  const cases = Array.isArray(body.cases) ? (body.cases as AskGoldenCase[]) : [];
  await saveGoldenCases(cases);
  return NextResponse.json({ ok: true, count: cases.length });
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAdminApi();
  if (error) return error;

  const adminId = session!.user!.id!;
  const body = await request.json().catch(() => ({}));
  const caseIds = Array.isArray(body.caseIds)
    ? body.caseIds.map(String)
    : undefined;
  const evalUserId =
    typeof body.userId === "string" && body.userId.trim()
      ? body.userId.trim()
      : adminId;

  const allowedIds = await resolveScopedDocIds(evalUserId, { mode: "all" });

  const report = await runAskEval({
    userId: evalUserId,
    allowedDocIds: allowedIds,
    caseIds,
  });

  return NextResponse.json(report);
}
