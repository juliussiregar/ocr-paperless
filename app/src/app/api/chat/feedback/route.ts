import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

/** Thumbs up/down on an Ask answer (stored in audit log). */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rating = body.rating === "down" ? "down" : body.rating === "up" ? "up" : null;
  const messageId =
    typeof body.messageId === "string" ? body.messageId.slice(0, 64) : null;
  const conversationId =
    typeof body.conversationId === "string"
      ? body.conversationId.slice(0, 64)
      : null;

  if (!rating) {
    return NextResponse.json({ error: "rating required" }, { status: 400 });
  }

  await writeAudit("chat.feedback", session.user.id, {
    rating,
    messageId,
    conversationId,
  });

  return NextResponse.json({ ok: true });
}
