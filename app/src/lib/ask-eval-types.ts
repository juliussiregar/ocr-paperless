export type AskGoldenCase = {
  id: string;
  question: string;
  expectedDocIds: number[];
  focusDocIds?: number[];
  topK?: number;
  notes?: string;
  /** Substring or regex patterns expected in answer (answer-quality eval) */
  expectedAnswerPatterns?: string[];
  evalMode?: "retrieval" | "answer" | "both";
};

export type AskEvalCaseResult = {
  id: string;
  question: string;
  hit: boolean | null;
  retrievedIds: number[];
  topK: number;
  expectedDocIds: number[];
  plannerIntent?: string;
  plannerKeywords?: string[];
  plannerSource?: string;
  durationMs: number;
  error?: string;
  answerHit?: boolean | null;
  answerSnippet?: string;
};

export type AskEvalReport = {
  ranAt: string;
  userId: string;
  total: number;
  hits: number;
  misses: number;
  skipped: number;
  hitRatePct: number;
  answerHits?: number;
  answerMisses?: number;
  answerHitRatePct?: number;
  results: AskEvalCaseResult[];
};
