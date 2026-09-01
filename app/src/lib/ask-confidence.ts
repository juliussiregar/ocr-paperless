export type AskConfidence = "high" | "medium" | "low";

export function computeAskConfidence(
  bestRetrievalScore: number,
  rankingTopScore: number,
  secondRankingScore: number
): AskConfidence {
  const retrieval = bestRetrievalScore;
  const gap =
    rankingTopScore > 0 && secondRankingScore > 0
      ? rankingTopScore / secondRankingScore
      : rankingTopScore > 0
        ? 2
        : 1;

  if (retrieval >= 0.42 && gap >= 1.3) return "high";
  if (retrieval >= 0.28 || gap >= 1.5 || rankingTopScore >= 80) return "medium";
  return "low";
}

export function shouldSuggestPin(
  confidence: AskConfidence,
  hasFocus: boolean,
  intent: string
): boolean {
  if (hasFocus || intent === "list") return false;
  return confidence === "low";
}

export function confidenceLabel(confidence: AskConfidence): string {
  switch (confidence) {
    case "high":
      return "Tinggi";
    case "medium":
      return "Sedang";
    default:
      return "Rendah";
  }
}
