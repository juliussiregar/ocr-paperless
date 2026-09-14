import type OpenAI from "openai";
import type { PaperlessDocument } from "./paperless";
import { searchDocuments } from "./paperless";
import { cachedSearchDocuments } from "./ask-search-cache";
import {
  formatRetrievedSnippets,
  retrieveRelevantChunks,
} from "./ask-retrieval";
import { isEmbeddingConfigured } from "./embeddings";
import { humanizeFileName } from "./display-name";
import {
  buildEvidenceFromChunks,
  mergeEvidence,
  type AskEvidence,
} from "./ask-evidence";

export { mergeEvidence };

function toolsEnabled(): boolean {
  const raw = process.env.ASK_TOOLS_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

function maxToolRounds(): number {
  const n = Number(process.env.ASK_TOOLS_MAX_ROUNDS ?? "3");
  if (!Number.isFinite(n)) return 3;
  return Math.min(3, Math.max(1, Math.floor(n)));
}

export function isAskToolsEnabled(): boolean {
  return toolsEnabled();
}

export function askToolsMaxRounds(): number {
  return maxToolRounds();
}

export const ASK_TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_archive",
      description:
        "Cari ulang dokumen di arsip user dengan kata kunci baru bila konteks kurang relevan.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Kata kunci pencarian (bahasa Indonesia atau nama file)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Baca cuplikan relevan dari satu dokumen by Paperless ID (halaman/chunk).",
      parameters: {
        type: "object",
        properties: {
          docId: { type: "number", description: "Paperless document ID" },
          focus: {
            type: "string",
            description: "Topik atau frasa yang ingin digali di dokumen",
          },
        },
        required: ["docId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_docs",
      description:
        "Ambil cuplikan dari beberapa dokumen sekaligus untuk perbandingan.",
      parameters: {
        type: "object",
        properties: {
          docIds: {
            type: "array",
            items: { type: "number" },
            description: "2–4 Paperless document IDs",
          },
          focus: {
            type: "string",
            description: "Aspek yang dibandingkan",
          },
        },
        required: ["docIds"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_facts",
      description:
        "Ekstrak fakta Bappenas (nomor surat, tanggal, agenda, keputusan, pihak) dari dokumen.",
      parameters: {
        type: "object",
        properties: {
          docId: { type: "number" },
          kinds: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "nomor_surat",
                "tanggal",
                "agenda",
                "keputusan",
                "pihak",
                "anggaran",
              ],
            },
          },
        },
        required: ["docId"],
      },
    },
  },
];

function displayName(doc: PaperlessDocument): string {
  const title = doc.title?.trim() ?? "";
  const file = doc.original_file_name?.trim() ?? "";
  const pick =
    title && !/^\d{8,}/.test(title) && title.length >= 3 ? title : file || title;
  return humanizeFileName(pick);
}

const FACT_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  {
    kind: "nomor_surat",
    re: /\b(?:No\.?|Nomor)\s*[:.]?\s*([A-Z0-9\/.\-]+)/gi,
  },
  {
    kind: "tanggal",
    re: /\b(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,
  },
  {
    kind: "agenda",
    re: /\b(?:Agenda|Acara|Pokok bahasan)\s*[:.]?\s*([^\n.]{8,120})/gi,
  },
  {
    kind: "keputusan",
    re: /\b(?:Keputusan|Memutuskan|Disepakati|Kesimpulan)\s*[:.]?\s*([^\n.]{8,160})/gi,
  },
  {
    kind: "pihak",
    re: /\b(?:Kepada|Undangan|Hadir|Peserta)\s*[:.]?\s*([^\n.]{8,120})/gi,
  },
  {
    kind: "anggaran",
    re: /\b(?:Rp\.?\s*[\d.]+(?:\s*(?:juta|miliar|ribu))?|anggaran\s*[:.]?\s*[^\n.]{5,80})/gi,
  },
];

export type AskToolContext = {
  userId: string;
  allowedDocIds?: number[];
  question: string;
  getDocument: (id: number) => Promise<PaperlessDocument>;
  docCache: Map<number, PaperlessDocument>;
  onStatus?: (status: string) => void;
};

export type AskToolResult = {
  /** Plain tool payload; do NOT embed [Sn] markers here (parent assigns global ids). */
  text: string;
  evidence: AskEvidence[];
  docs: PaperlessDocument[];
};

async function loadDoc(
  ctx: AskToolContext,
  id: number
): Promise<PaperlessDocument | null> {
  if (ctx.allowedDocIds && !ctx.allowedDocIds.includes(id)) return null;
  const cached = ctx.docCache.get(id);
  if (cached) return cached;
  try {
    const doc = await ctx.getDocument(id);
    ctx.docCache.set(id, doc);
    return doc;
  } catch {
    return null;
  }
}

async function readChunksForDocs(
  ctx: AskToolContext,
  docs: PaperlessDocument[],
  focus?: string
): Promise<AskToolResult> {
  if (docs.length === 0) {
    return { text: "Tidak ada dokumen yang bisa dibaca.", evidence: [], docs: [] };
  }

  const question = [ctx.question, focus ?? ""].join(" ").trim();
  let evidence: AskEvidence[] = [];
  const parts: string[] = [];

  if (ctx.userId && isEmbeddingConfigured()) {
    const retrieval = await retrieveRelevantChunks({
      userId: ctx.userId,
      docs,
      question,
      maxChunks: 12,
      chunksPerDoc: 4,
      maxChunkChars: 1000,
      docLimit: Math.min(4, docs.length),
    });
    const chunkItems: Array<{
      docId: number;
      title: string;
      fileName: string;
      page: number | null;
      content: string;
    }> = [];
    for (const id of retrieval.docOrder) {
      const doc = docs.find((d) => d.id === id);
      if (!doc) continue;
      const chunks = retrieval.byDoc.get(id) ?? [];
      parts.push(
        `[Dokumen ${displayName(doc)} | ID ${doc.id}]\n${formatRetrievedSnippets(chunks, 1000)}`
      );
      for (const c of chunks) {
        chunkItems.push({
          docId: doc.id,
          title: displayName(doc),
          fileName: doc.original_file_name,
          page: c.pageEstimate,
          content: c.content,
        });
      }
    }
    // Temporary ids only; parent mergeEvidence renumbers globally
    evidence = buildEvidenceFromChunks(chunkItems);
  }

  if (parts.length === 0) {
    for (const doc of docs.slice(0, 4)) {
      const body = (doc.content ?? "").replace(/\s+/g, " ").trim().slice(0, 3500);
      parts.push(
        `[Dokumen ${displayName(doc)} | ID ${doc.id}]\n${body || "(kosong)"}`
      );
    }
    evidence = buildEvidenceFromChunks(
      docs.slice(0, 4).map((doc) => ({
        docId: doc.id,
        title: displayName(doc),
        fileName: doc.original_file_name,
        page: null,
        content: (doc.content ?? "").replace(/\s+/g, " ").trim().slice(0, 800),
      }))
    );
  }

  // No [Sn] block in tool text: avoids colliding with global markers in system context
  return {
    text: parts.join("\n\n---\n\n"),
    evidence,
    docs,
  };
}

export async function executeAskTool(
  name: string,
  argsJson: string,
  ctx: AskToolContext
): Promise<AskToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return { text: "Argumen tool tidak valid (JSON).", evidence: [], docs: [] };
  }

  if (name === "search_archive") {
    const query = String(args.query ?? "").trim();
    if (!query) {
      return { text: "Query kosong.", evidence: [], docs: [] };
    }
    ctx.onStatus?.(`Mencari ulang: ${query.slice(0, 60)}…`);
    const hits = await cachedSearchDocuments(
      searchDocuments,
      query,
      {
        pageSize: 12,
        ordering: "-created",
      },
      ctx.userId
    );
    const allowed = ctx.allowedDocIds ? new Set(ctx.allowedDocIds) : null;
    const docs: PaperlessDocument[] = [];
    for (const d of hits.results ?? []) {
      if (allowed && !allowed.has(d.id)) continue;
      ctx.docCache.set(d.id, d);
      docs.push(d);
      if (docs.length >= 8) break;
    }
    if (docs.length === 0) {
      return {
        text: `Tidak ditemukan dokumen untuk "${query}".`,
        evidence: [],
        docs: [],
      };
    }
    const lines = docs.map(
      (d, i) =>
        `${i + 1}. ID ${d.id} · ${displayName(d)} · ${d.original_file_name}`
    );
    return {
      text: `Hasil pencarian (${docs.length}):\n${lines.join("\n")}`,
      evidence: [],
      docs,
    };
  }

  if (name === "read_document") {
    const docId = Number(args.docId);
    const focus = typeof args.focus === "string" ? args.focus : undefined;
    if (!Number.isInteger(docId) || docId <= 0) {
      return { text: "docId tidak valid.", evidence: [], docs: [] };
    }
    ctx.onStatus?.(`Membaca dokumen ${docId}…`);
    const doc = await loadDoc(ctx, docId);
    if (!doc) {
      return {
        text: `Dokumen ${docId} tidak tersedia di scope Anda.`,
        evidence: [],
        docs: [],
      };
    }
    return readChunksForDocs(ctx, [doc], focus);
  }

  if (name === "compare_docs") {
    const rawIds = Array.isArray(args.docIds) ? args.docIds : [];
    const ids = rawIds
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 4);
    const focus = typeof args.focus === "string" ? args.focus : undefined;
    if (ids.length < 2) {
      return {
        text: "compare_docs membutuhkan minimal 2 docIds.",
        evidence: [],
        docs: [],
      };
    }
    ctx.onStatus?.(`Membandingkan ${ids.length} dokumen…`);
    const docs: PaperlessDocument[] = [];
    for (const id of ids) {
      const d = await loadDoc(ctx, id);
      if (d) docs.push(d);
    }
    if (docs.length < 2) {
      return {
        text: "Tidak cukup dokumen valid untuk dibandingkan.",
        evidence: [],
        docs,
      };
    }
    return readChunksForDocs(ctx, docs, focus);
  }

  if (name === "extract_facts") {
    const docId = Number(args.docId);
    const kinds = Array.isArray(args.kinds)
      ? args.kinds.map(String)
      : FACT_PATTERNS.map((p) => p.kind);
    if (!Number.isInteger(docId) || docId <= 0) {
      return { text: "docId tidak valid.", evidence: [], docs: [] };
    }
    ctx.onStatus?.(`Mengekstrak fakta dari dokumen ${docId}…`);
    const doc = await loadDoc(ctx, docId);
    if (!doc) {
      return {
        text: `Dokumen ${docId} tidak tersedia.`,
        evidence: [],
        docs: [],
      };
    }
    const text = (doc.content ?? "").replace(/\s+/g, " ").trim();
    const found: string[] = [];
    const kindSet = new Set(kinds);
    for (const { kind, re } of FACT_PATTERNS) {
      if (!kindSet.has(kind)) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = re.exec(text)) !== null && count < 5) {
        found.push(`${kind}: ${m[0].slice(0, 160)}`);
        count += 1;
      }
    }
    const quote = text.slice(0, 800);
    const evidence = buildEvidenceFromChunks([
      {
        docId: doc.id,
        title: displayName(doc),
        fileName: doc.original_file_name,
        page: null,
        content: quote,
      },
    ]);
    return {
      text:
        found.length > 0
          ? `Fakta dari ${displayName(doc)} (ID ${doc.id}):\n${found.join("\n")}`
          : `Tidak menemukan pola fakta eksplisit di ${displayName(doc)}. Cuplikan awal:\n${quote.slice(0, 500)}`,
      evidence,
      docs: [doc],
    };
  }

  return { text: `Tool tidak dikenal: ${name}`, evidence: [], docs: [] };
}
