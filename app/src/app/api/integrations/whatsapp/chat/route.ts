import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ChatRole } from "@prisma/client";
import {
  askDocumentsStream,
  titleFromQuestion,
  type ChatHistoryMessage,
} from "@/lib/openai";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  parseScope,
  resolveScopedDocIds,
  serializeScope,
  type ChatScope,
} from "@/lib/chat-scope";
import {
  buildWhatsAppDocuments,
  getWhatsAppIntegrationUser,
  publicAppBaseUrl,
  whatsAppUserEmail,
} from "@/lib/whatsapp-api";

export const runtime = "nodejs";

/**
 * WhatsApp integration: Ask AI for fixed portal user (WHATSAPP_USER_EMAIL).
 * Open endpoint (no API key). Non-stream JSON only.
 */
export async function POST(request: NextRequest) {
  const user = await getWhatsAppIntegrationUser();
  if (!user) {
    return NextResponse.json(
      {
        error: `User integrasi tidak ditemukan: ${whatsAppUserEmail()}`,
      },
      { status: 404 }
    );
  }

  const userId = user.id;
  const rl = rateLimit(`whatsapp-chat:${userId}`, 60, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: `Batas pertanyaan tercapai. Coba lagi dalam ${rl.retryAfterSec} detik.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const question = String(body.question ?? "").trim();
  let conversationId = body.conversationId
    ? String(body.conversationId)
    : null;

  if (!question) {
    return NextResponse.json(
      { error: "Pertanyaan tidak boleh kosong" },
      { status: 400 }
    );
  }
  if (question.length > 2000) {
    return NextResponse.json(
      { error: "Pertanyaan terlalu panjang (max 2000 karakter)" },
      { status: 400 }
    );
  }

  let conversation = conversationId
    ? await prisma.chatConversation.findFirst({
        where: { id: conversationId, userId },
      })
    : null;

  if (conversationId && !conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (!conversation) {
    const scope: ChatScope = body.scope ?? { mode: "all" };
    conversation = await prisma.chatConversation.create({
      data: {
        userId,
        title: titleFromQuestion(question),
        scope: serializeScope(scope),
      },
    });
    conversationId = conversation.id;
  }

  const scope = parseScope(conversation.scope);
  const allowedIds = await resolveScopedDocIds(userId, scope);

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: ChatRole.USER,
      content: question,
    },
  });

  const prior = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 11,
  });

  const history: ChatHistoryMessage[] = prior
    .slice(1)
    .reverse()
    .map((m) => ({
      role: m.role === ChatRole.USER ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }))
    .slice(-10);

  const isFirstAssistant =
    prior.filter((m) => m.role === ChatRole.ASSISTANT).length === 0;

  try {
    let answer = "";
    const result = await askDocumentsStream(
      question,
      allowedIds,
      history,
      (token) => {
        answer += token;
      },
      undefined,
      undefined,
      userId
    );
    answer = result.answer;

    const baseUrl = publicAppBaseUrl(request);
    const documents = await buildWhatsAppDocuments(
      result.citations,
      userId,
      baseUrl
    );

    const assistant = await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: ChatRole.ASSISTANT,
        content: answer,
        citations: JSON.stringify(result.citations),
      },
    });

    const nextTitle =
      conversation.title === "New chat" || isFirstAssistant
        ? titleFromQuestion(question)
        : conversation.title;

    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { title: nextTitle, updatedAt: new Date() },
    });

    const u = result.usage;
    const chatHits = u?.chatHits ?? 0;
    const embeddingHits = u?.embeddingHits ?? 0;
    await writeAudit("chat.whatsapp", userId, {
      question: question.slice(0, 200),
      citations: documents.length,
      conversationId: conversation.id,
      channel: "whatsapp",
      openai: chatHits > 0 || embeddingHits > 0,
      model: u?.model,
      promptTokens: u?.promptTokens ?? 0,
      completionTokens: u?.completionTokens ?? 0,
      totalTokens: u?.totalTokens ?? 0,
      embeddingTokens: u?.embeddingTokens ?? 0,
      embeddingHits,
      chatHits,
      estimatedCostUsd: u?.estimatedCostUsd ?? 0,
    });

    return NextResponse.json({
      conversationId: conversation.id,
      messageId: assistant.id,
      title: nextTitle,
      answer,
      documents,
      user: { email: user.email, name: user.name },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed";
    await writeAudit("error.chat.whatsapp", userId, {
      question: question.slice(0, 200),
      conversationId: conversation.id,
      error: message.slice(0, 500),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
