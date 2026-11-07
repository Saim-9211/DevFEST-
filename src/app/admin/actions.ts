"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const cycleStatus = z.enum([
  "draft", "open", "locked", "bidding", "awarded", "confirming",
  "ordered", "dispatched", "delivered", "distributing", "closed", "cancelled",
]);

export async function verifySupplier(supplierId: string) {
  await requireArea("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({ verified: true }).eq("id", z.uuid().parse(supplierId));
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

/** Move a cycle along the state machine. Legality is checked by the `transition_cycle` RPC. */
export async function advanceCycle(cycleId: string, to: string) {
  await requireArea("admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_cycle", {
    p_cycle: z.uuid().parse(cycleId),
    p_to: cycleStatus.parse(to),
    p_note: "Moved from admin control room",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
