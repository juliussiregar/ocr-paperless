import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import type { SearchPlan } from "./ask-search-planner";
import { askDocuments, evaluateAskRetrieval } from "./openai";
import type {
  AskEvalCaseResult,
  AskEvalReport,
  AskGoldenCase,
} from "./ask-eval-types";

export type { AskGoldenCase, AskEvalCaseResult, AskEvalReport } from "./ask-eval-types";

const SETTING_KEY = "ask_golden_cases";

export async function loadGoldenCases(): Promise<AskGoldenCase[]> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: SETTING_KEY },
      select: { value: true },
    });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as { cases?: AskGoldenCase[] };
      if (Array.isArray(parsed.cases) && parsed.cases.length > 0) {
        return parsed.cases;
      }
    }
  } catch {
    // fallback file
  }

  const candidates = [
    path.join(process.cwd(), "data", "ask-golden-set.json"),
    path.join(process.cwd(), "..", "data", "ask-golden-set.json"),
  ];
  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { cases?: AskGoldenCase[] };
      if (Array.isArray(parsed.cases) && parsed.cases.length > 0) {
        return parsed.cases;
      }
    } catch {
      // try next path
    }
  }
  return [];
}

export async function saveGoldenCases(cases: AskGoldenCase[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify({ cases }) },
    update: { value: JSON.stringify({ cases }) },
  });
}

export async function runAskEval(opts: {
  userId: string;
  allowedDocIds?: number[];
  caseIds?: string[];
}): Promise<AskEvalReport> {
  const all = await loadGoldenCases();
  const cases =
    opts.caseIds && opts.caseIds.length > 0
      ? all.filter((c) => opts.caseIds!.includes(c.id))
      : all;

  const results: AskEvalCaseResult[] = [];
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  let answerHits = 0;
  let answerMisses = 0;

  for (const c of cases) {
    const start = Date.now();
    try {
      const evalResult = await evaluateAskRetrieval(
        c.question,
        opts.allowedDocIds,
        c.focusDocIds ?? [],
        opts.userId
      );
      const topK = c.topK ?? 3;
      const topIds = evalResult.retrievedIds.slice(0, topK);
      const expected = c.expectedDocIds ?? [];
      let hit: boolean | null = null;
      if (expected.length === 0) {
        skipped += 1;
      } else {
        hit = expected.some((id) => topIds.includes(id));
        if (hit) hits += 1;
        else misses += 1;
      }

      let answerHit: boolean | null = null;
      let answerSnippet: string | undefined;
      const mode = c.evalMode ?? (c.expectedAnswerPatterns?.length ? "both" : "retrieval");

      if (
        (mode === "answer" || mode === "both") &&
        c.expectedAnswerPatterns &&
        c.expectedAnswerPatterns.length > 0
      ) {
        try {
          const answerResult = await askDocuments(
            c.question,
            opts.allowedDocIds,
            [],
            c.focusDocIds,
            opts.userId
          );
          answerSnippet = answerResult.answer.slice(0, 400);
          const text = answerResult.answer.toLowerCase();
          answerHit = c.expectedAnswerPatterns.some((p) => {
            try {
              return new RegExp(p, "i").test(answerResult.answer);
            } catch {
              return text.includes(p.toLowerCase());
            }
          });
          if (answerHit) answerHits += 1;
          else answerMisses += 1;
        } catch {
          answerHit = false;
          answerMisses += 1;
        }
      }

      results.push({
        id: c.id,
        question: c.question,
        hit,
        retrievedIds: evalResult.retrievedIds,
        topK,
        expectedDocIds: expected,
        plannerIntent: evalResult.searchPlan?.intent,
        plannerKeywords: evalResult.searchPlan?.keywords,
        plannerSource: evalResult.searchPlan?.source,
        durationMs: Date.now() - start,
        answerHit,
        answerSnippet,
      });
    } catch (err) {
      results.push({
        id: c.id,
        question: c.question,
        hit: false,
        retrievedIds: [],
        topK: c.topK ?? 3,
        expectedDocIds: c.expectedDocIds ?? [],
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      misses += 1;
    }
  }

  const scored = hits + misses;
  const answerScored = answerHits + answerMisses;
  return {
    ranAt: new Date().toISOString(),
    userId: opts.userId,
    total: cases.length,
    hits,
    misses,
    skipped,
    hitRatePct: scored > 0 ? Math.round((hits / scored) * 100) : 0,
    answerHits,
    answerMisses,
    answerHitRatePct:
      answerScored > 0 ? Math.round((answerHits / answerScored) * 100) : undefined,
    results,
  };
}

export type { SearchPlan };
