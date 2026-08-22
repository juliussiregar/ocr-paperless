import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";

/** Sync merged into Library; keep URL for old bookmarks. */
export default async function SyncPage() {
  await requireAuth();
  redirect("/cloud");
}
