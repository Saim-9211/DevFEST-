"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/components/form";

/** Record the cash balance the agent just collected. The DB enforces agent + assigned building. */
export async function collectCash(basketId: string): Promise<FormState> {
  await requireArea("agent");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_cash_payment", { p_basket: z.uuid().parse(basketId) });
  if (error) return { error: error.message };
  revalidatePath("/agent");
  return { success: `Cash recorded · receipt ${data}` };
}
