"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/components/form";

const uuid = z.uuid();

async function admin() {
  await requireArea("admin");
  return createClient();
}

function done(cycleId?: string) {
  revalidatePath("/admin", "layout");
  if (cycleId) revalidatePath(`/admin/cycles/${cycleId}`);
}

export async function verifySupplier(supplierId: string) {
  const supabase = await admin();
  const { error } = await supabase.from("suppliers").update({ verified: true }).eq("id", uuid.parse(supplierId));
  if (error) throw new Error(error.message);
  done();
}

/** Every cycle step goes through its database RPC; the DB checks legality and audits it. */
const STEP_RPC = {
  open: "transition_cycle",
  cutoff: "run_cutoff",
  issue_pos: "issue_purchase_orders",
  dispatched: "transition_cycle",
  delivered: "transition_cycle",
  distribute: "start_distribution",
  close: "close_cycle",
  cancel: "cancel_cycle",
} as const;
export type CycleStep = keyof typeof STEP_RPC;

export async function runCycleStep(cycleId: string, step: CycleStep) {
  const supabase = await admin();
  const id = uuid.parse(cycleId);
  const rpc = STEP_RPC[step];
  const args =
    rpc === "transition_cycle"
      ? { p_cycle: id, p_to: step === "open" ? "open" : step, p_note: "Admin control room" }
      : { p_cycle: id };
  const { error } = await supabase.rpc(rpc, args);
  if (error) throw new Error(error.message);
  done(id);
}

export async function selectQuote(cycleId: string, lotId: string, formData: FormData) {
  const supabase = await admin();
  const { error } = await supabase.rpc("select_quote", { p_lot: uuid.parse(lotId), p_quote: uuid.parse(formData.get("quote_id")) });
  if (error) throw new Error(error.message);
  done(cycleId);
}

export async function saveOffer(cycleId: string, productId: string, _: FormState, formData: FormData): Promise<FormState> {
  const supabase = await admin();
  const price = z.coerce.number().positive().safeParse(formData.get("offer_price"));
  if (!price.success) return { error: "Enter a price" };
  const { error } = await supabase
    .from("cycle_offers")
    .upsert({ cycle_id: uuid.parse(cycleId), product_id: uuid.parse(productId), offer_price: price.data }, { onConflict: "cycle_id,product_id" });
  if (error) return { error: error.message };
  done(cycleId);
  return { success: "Saved" };
}

const newCycle = z.object({
  cluster_id: uuid,
  name: z.string().trim().min(3).max(80),
  open_at: z.coerce.date(),
  cutoff_at: z.coerce.date(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deposit_pct: z.coerce.number().min(10).max(20),
  min_order_value: z.coerce.number().min(0),
  min_households: z.coerce.number().int().min(1),
});

/** New draft cycle; offers are copied from the cluster's latest cycle as a starting point. */
export async function createCycle(_: FormState, formData: FormData): Promise<FormState> {
  const supabase = await admin();
  const parsed = newCycle.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.cutoff_at <= d.open_at) return { error: "Cutoff must be after opening" };

  const { data: prev } = await supabase
    .from("buying_cycles")
    .select("id")
    .eq("cluster_id", d.cluster_id)
    .order("open_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: created, error } = await supabase
    .from("buying_cycles")
    .insert({ ...d, open_at: d.open_at.toISOString(), cutoff_at: d.cutoff_at.toISOString(), status: "draft" })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (prev) {
    const { data: offers } = await supabase.from("cycle_offers").select("product_id, offer_price").eq("cycle_id", prev.id);
    if (offers?.length) {
      await supabase.from("cycle_offers").insert(offers.map((o) => ({ ...o, cycle_id: created.id })));
    }
  }
  done();
  redirect(`/admin/cycles/${created.id}`);
}

export async function markCashDeposited(agentId: string) {
  const supabase = await admin();
  const { error } = await supabase.rpc("mark_cash_deposited", { p_agent: uuid.parse(agentId) });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/payments");
}

export async function resolveClaim(disputeId: string, approve: boolean) {
  const supabase = await admin();
  const { error } = await supabase.rpc("resolve_claim", {
    p_dispute: uuid.parse(disputeId),
    p_approve: approve,
    p_note: approve ? "Approved after batch inspection" : "Rejected after batch inspection",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/returns");
}
