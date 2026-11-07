"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/components/form";

// Authorization for every action is enforced again inside the database RPC.

export async function reviewMember(memberId: string, approve: boolean) {
  await requireArea("ambassador");
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_membership", { p_member: z.uuid().parse(memberId), p_approve: approve });
  if (error) throw new Error(error.message);
  revalidatePath("/ambassador");
}

export async function checkInDelivery(deliveryId: string) {
  await requireArea("ambassador");
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_in_delivery", { p_delivery: z.uuid().parse(deliveryId), p_notes: null });
  if (error) throw new Error(error.message);
  revalidatePath("/ambassador");
}

/** Shared by ambassador and agent pickup desks. */
export async function handOver(basketId: string, _: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "Enter the 6-digit pickup code" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_handover", { p_basket: z.uuid().parse(basketId), p_code: code });
  if (error) return { error: error.message };
  revalidatePath("/ambassador");
  revalidatePath("/agent");
  return { success: "Handed over ✓" };
}
