import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/session";
import { getAskReadinessGlobal } from "@/lib/ask-readiness";
import { getDbClientCount, dbHotClientsThreshold } from "@/lib/db-load";

export async function GET() {
  const { error } = await requireAdminApi();
  if (error) return error;

  const [ask, dbClients] = await Promise.all([
    getAskReadinessGlobal(),
    getDbClientCount(),
  ]);

  return NextResponse.json({
    ask,
    db: {
      clients: dbClients,
      hotThreshold: dbHotClientsThreshold(),
      hot: dbClients != null && dbClients >= dbHotClientsThreshold(),
    },
  });
}
