let checked = false;
let available = false;

/** Detect pgvector extension (cached per process). */
export async function isPgvectorAvailable(): Promise<boolean> {
  if (checked) return available;
  try {
    const { prisma } = await import("./prisma");
    const rows = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'"
    );
    available = rows.length > 0;
  } catch {
    available = false;
  }
  checked = true;
  return available;
}

export function vectorLiteral(vec: number[]): string {
  return `[${vec.map((n) => Number(n).toFixed(8)).join(",")}]`;
}

export const EMBEDDING_DIM = 1536;
