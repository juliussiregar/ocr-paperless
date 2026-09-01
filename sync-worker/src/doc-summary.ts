import { prisma } from "./db.js";

function vectorLiteral(vec: number[]): string {
  return `[${vec.map((n) => Number(n).toFixed(8)).join(",")}]`;
}

function summaryEnabled(): boolean {
  return (process.env.ASK_DOC_SUMMARY_ENABLED ?? "true") !== "false";
}

function summaryModel(): string {
  return process.env.ASK_SUMMARY_MODEL?.trim() || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

/**
 * Precompute short doc summary + doc-level embedding for Ask retrieval.
 */
export async function indexDocSummary(opts: {
  userId: string;
  syncFileId: string;
  paperlessDocumentId: number;
  fileName: string;
  content: string;
}): Promise<void> {
  if (!summaryEnabled()) return;

  const existing = await prisma.syncFile.findUnique({
    where: { id: opts.syncFileId },
    select: { docSummary: true, fileName: true },
  });
  if (existing?.docSummary && existing.docSummary.trim().length > 20) return;

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey.startsWith("sk-")) return;

  const preview = opts.content.replace(/\s+/g, " ").trim().slice(0, 4500);
  if (preview.length < 40) return;

  let summary = preview.slice(0, 500);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: summaryModel(),
        temperature: 0,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Ringkas dokumen arsip pemerintah dalam 3-5 kalimat Bahasa Indonesia. " +
              "Sebut jenis dokumen, topik, lokasi/institusi jika ada. Tanpa judul file.",
          },
          {
            role: "user",
            content: `Nama file: ${opts.fileName}\n\nCuplikan OCR:\n${preview}`,
          },
        ],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= 30) summary = text.slice(0, 800);
    }
  } catch {
    // keep preview fallback
  }

  const embedText = `${opts.fileName}\n${summary}`.slice(0, 8000);
  const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      input: embedText,
    }),
  });
  if (!embedRes.ok) return;
  const embedData = (await embedRes.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  const vec = embedData.data?.[0]?.embedding;
  if (!vec) return;

  await prisma.syncFile.update({
    where: { id: opts.syncFileId },
    data: {
      docSummary: summary,
      docEmbedding: vec,
    },
  });
}

export async function backfillChunkEmbeddingVec(
  userId: string,
  paperlessDocumentId: number
): Promise<void> {
  try {
    const chunks = await prisma.documentChunk.findMany({
      where: { userId, paperlessDocumentId },
      select: { id: true, embedding: true },
    });
    for (const c of chunks) {
      if (!Array.isArray(c.embedding) || c.embedding.length === 0) continue;
      const vec = vectorLiteral(c.embedding as number[]);
      await prisma.$executeRawUnsafe(
        `UPDATE document_chunks SET embedding_vec = '${vec}'::vector WHERE id = $1`,
        c.id
      );
    }
  } catch (err) {
    console.warn(
      `[embed] embedding_vec update skipped doc=${paperlessDocumentId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
