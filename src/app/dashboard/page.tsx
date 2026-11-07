import { redirect } from "next/navigation";
import { getSessionContext, homePath } from "@/lib/auth";

/** Sends each user to the right home for their role. */
export default async function DashboardRedirect() {
  const ctx = await getSessionContext();
  redirect(ctx ? homePath(ctx) : "/login");
}
