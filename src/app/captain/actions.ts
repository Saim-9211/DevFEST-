"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Approve or reject a pending membership. Authorization is enforced in the `review_membership` RPC. */
export async function reviewMember(memberId: string, approve: boolean) {
  const id = z.uuid().parse(memberId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_membership", { p_member: id, p_approve: approve });
  if (error) throw new Error(error.message);
  revalidatePath("/captain");
}
