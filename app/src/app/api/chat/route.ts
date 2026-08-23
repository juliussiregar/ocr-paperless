import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChatRole } from "@prisma/client";
import {
  askDocumentsStream,
  titleFromQuestion,
  type ChatCitation,
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

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const rl = rateLimit(`chat:${userId}`, 30, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: `Batas pertanyaan AI tercapai. Coba lagi dalam ${rl.retryAfterSec} detik.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json();
  const question = String(body.question ?? "").trim();
  let conversationId = body.conversationId
    ? String(body.conversationId)
    : null;
  const stream = body.stream !== false;
  const focusDocIds: number[] = Array.isArray(body.focusDocIds)
    ? body.focusDocIds
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n > 0)
        .slice(0, 5)
    : [];

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

  // Exclude the user message we just inserted; send up to 10 prior turns
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

  if (!stream) {
    try {
      let answer = "";
      const result = await askDocumentsStream(
        question,
        allowedIds,
        history,
        (t) => {
          answer += t;
        },
        focusDocIds,
        undefined,
        userId
      );
      answer = result.answer;

      const assistant = await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: ChatRole.ASSISTANT,
          content: answer,
          citations: JSON.stringify(result.citations),
        },
      });

      if (isFirstAssistant && conversation.title === "New chat") {
        await prisma.chatConversation.update({
          where: { id: conversation.id },
          data: { title: titleFromQuestion(question) },
        });
      } else {
        await prisma.chatConversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });
      }

      const u = result.usage;
      const chatHits = u?.chatHits ?? 0;
      const embeddingHits = u?.embeddingHits ?? 0;
      const usedOpenAi = chatHits > 0 || embeddingHits > 0;
      await writeAudit("chat.ask", userId, {
        question: question.slice(0, 200),
        citations: result.citations.length,
        conversationId: conversation.id,
        openai: usedOpenAi,
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
        answer,
        citations: result.citations,
        title: titleFromQuestion(question),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      await writeAudit("error.chat", userId, {
        question: question.slice(0, 200),
        conversationId: conversation.id,
        error: message.slice(0, 500),
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      function send(obj: unknown) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
        );
      }

      try {
        send({
          type: "meta",
          conversationId: conversation!.id,
          title:
            conversation!.title === "New chat"
              ? titleFromQuestion(question)
              : conversation!.title,
        });

        let citations: ChatCitation[] = [];
        let answer = "";

        const result = await askDocumentsStream(
          question,
          allowedIds,
          history,
          (token) => {
            answer += token;
            send({ type: "token", content: token });
          },
          focusDocIds,
          (docsReading) => {
            send({ type: "reading", citations: docsReading });
          },
          userId
        );
        citations = result.citations;
        answer = result.answer;

        send({ type: "citations", citations });

        const assistant = await prisma.chatMessage.create({
          data: {
            conversationId: conversation!.id,
            role: ChatRole.ASSISTANT,
            content: answer,
            citations: JSON.stringify(citations),
          },
        });

        const nextTitle =
          conversation!.title === "New chat" || isFirstAssistant
            ? titleFromQuestion(question)
            : conversation!.title;

        await prisma.chatConversation.update({
          where: { id: conversation!.id },
          data: {
            title: nextTitle,
            updatedAt: new Date(),
          },
        });

        const u = result.usage;
        const chatHits = u?.chatHits ?? 0;
        const embeddingHits = u?.embeddingHits ?? 0;
        const usedOpenAi = chatHits > 0 || embeddingHits > 0;
        await writeAudit("chat.ask", userId, {
          question: question.slice(0, 200),
          citations: citations.length,
          conversationId: conversation!.id,
          openai: usedOpenAi,
          model: u?.model,
          promptTokens: u?.promptTokens ?? 0,
          completionTokens: u?.completionTokens ?? 0,
          totalTokens: u?.totalTokens ?? 0,
          embeddingTokens: u?.embeddingTokens ?? 0,
          embeddingHits,
          chatHits,
          estimatedCostUsd: u?.estimatedCostUsd ?? 0,
        });

        send({
          type: "done",
          messageId: assistant.id,
          title: nextTitle,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat failed";
        await writeAudit("error.chat", userId, {
          question: question.slice(0, 200),
          conversationId: conversation!.id,
          error: message.slice(0, 500),
        });
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
