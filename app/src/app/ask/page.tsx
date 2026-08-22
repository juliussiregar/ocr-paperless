import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";

/** Ask is the home route; keep /ask for old links. */
export default async function AskRedirectPage() {
  await requireAuth();
  redirect("/");
}
