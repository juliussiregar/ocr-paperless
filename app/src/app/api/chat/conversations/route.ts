import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeScope, type ChatScope } from "@/lib/chat-scope";

/** List conversations for current user */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.chatConversation.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      scope: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      scope: c.scope,
      updatedAt: c.updatedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
      messageCount: c._count.messages,
    })),
  });
}

/** Create a new empty conversation */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let scope: ChatScope = { mode: "all" };
  try {
    const body = await request.json();
    if (body?.scope) scope = body.scope as ChatScope;
  } catch {
    // empty body ok
  }

  const conversation = await prisma.chatConversation.create({
    data: {
      userId: session.user.id,
      title: "New chat",
      scope: serializeScope(scope),
    },
  });

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    scope: conversation.scope,
    updatedAt: conversation.updatedAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    messageCount: 0,
  });
}
