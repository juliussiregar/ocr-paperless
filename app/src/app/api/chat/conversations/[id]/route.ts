import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeScope, type ChatScope } from "@/lib/chat-scope";

type Ctx = { params: Promise<{ id: string }> };

async function ownedConversation(userId: string, id: string) {
  return prisma.chatConversation.findFirst({
    where: { id, userId },
  });
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await ownedConversation(session.user.id, id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    scope: conversation.scope,
    updatedAt: conversation.updatedAt.toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
      citations: m.citations ? JSON.parse(m.citations) : undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await ownedConversation(session.user.id, id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const data: { title?: string; scope?: string } = {};
  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 120);
  }
  if (body.scope) {
    data.scope = serializeScope(body.scope as ChatScope);
  }

  const updated = await prisma.chatConversation.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    scope: updated.scope,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await ownedConversation(session.user.id, id);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.chatConversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
