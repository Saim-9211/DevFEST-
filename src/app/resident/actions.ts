"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeMembership, requireArea } from "@/lib/auth";
import { getCurrentCycle, getMyBasket } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { simulateGatewayCallback, ONLINE_METHODS } from "@/lib/payments/gateway";
import type { FormState } from "@/components/form";

const method = z.enum(ONLINE_METHODS);

/** Current cycle + the household's basket (creating a draft basket when asked). */
async function context(createIfMissing = false) {
  const ctx = await requireArea("resident");
  const m = activeMembership(ctx);
  if (!m || m.status !== "approved") throw new Error("Your flat is not approved yet.");
  const cycle = await getCurrentCycle(m.building.cluster_id);
  if (!cycle) throw new Error("No order cycle is open.");
  let basket = await getMyBasket(cycle.id, ctx.userId);
  if (!basket && createIfMissing) {
    const supabase = await createClient();
    const { error } = await supabase
      .from("baskets")
      .insert({ cycle_id: cycle.id, user_id: ctx.userId, building_id: m.building_id });
    if (error) throw new Error(error.message);
    basket = await getMyBasket(cycle.id, ctx.userId);
  }
  return { ctx, cycle, basket };
}

function refresh() {
  revalidatePath("/resident", "layout");
}

/** Set an item's quantity (0 removes it). Prices are applied by the database. */
export async function setItemQty(productId: string, formData: FormData) {
  const qty = z.coerce.number().int().min(0).max(50).parse(formData.get("qty"));
  const pid = z.uuid().parse(productId);
  const { basket } = await context(qty > 0);
  if (!basket) return;
  const supabase = await createClient();
  const { error } =
    qty === 0
      ? await supabase.from("basket_items").delete().eq("basket_id", basket.id).eq("product_id", pid)
      : await supabase
          .from("basket_items")
          .upsert({ basket_id: basket.id, product_id: pid, qty }, { onConflict: "basket_id,product_id" });
  if (error) throw new Error(error.message);
  refresh();
}

/** Place the order (draft -> pending deposit) and start the deposit payment. */
export async function placeOrderAndPay(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = method.safeParse(formData.get("method"));
  if (!parsed.success) return { error: "Choose a payment method" };
  let paymentId: string;
  try {
    const { basket } = await context();
    if (!basket) return { error: "Your basket is empty" };
    const supabase = await createClient();
    if (basket.status === "draft") {
      const { error } = await supabase.rpc("place_order", { p_basket: basket.id });
      if (error) return { error: error.message };
    }
    const { data, error } = await supabase.rpc("start_payment", { p_basket: basket.id, p_kind: "deposit", p_method: parsed.data });
    if (error) return { error: error.message };
    paymentId = data as string;
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/resident/pay/${paymentId}`);
}

/** Start the balance payment at pickup. */
export async function payBalance(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = method.safeParse(formData.get("method"));
  if (!parsed.success) return { error: "Choose a payment method" };
  let paymentId: string;
  try {
    const { basket } = await context();
    if (!basket) return { error: "No order found" };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_payment", { p_basket: basket.id, p_kind: "balance", p_method: parsed.data });
    if (error) return { error: error.message };
    paymentId = data as string;
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(`/resident/pay/${paymentId}`);
}

export async function applyCredit(): Promise<void> {
  const { basket } = await context();
  if (!basket) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_credit", { p_basket: basket.id });
  if (error) throw new Error(error.message);
  refresh();
}

/**
 * Simulated gateway: the resident "approves" or "declines" in the mock checkout. We post a signed
 * event through the same handler as the real webhook (/api/payments/webhook).
 */
export async function completeMockPayment(paymentId: string, outcome: "success" | "failed") {
  const ctx = await requireArea("resident");
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("payments")
    .select("provider_ref, amount, method, user_id, state")
    .eq("id", z.uuid().parse(paymentId))
    .single();
  if (!p || p.user_id !== ctx.userId) throw new Error("Payment not found");
  if (p.state === "pending") {
    const result = await simulateGatewayCallback({
      provider_ref: p.provider_ref as string,
      amount: Number(p.amount),
      status: outcome,
      method: p.method as string,
    });
    if (!result.ok) throw new Error(result.error);
  }
  refresh();
  redirect(`/resident/pay/${paymentId}`);
}

export async function generatePickupCode(): Promise<FormState> {
  try {
    const { basket } = await context();
    if (!basket) return { error: "No order found" };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("generate_pickup_otp", { p_basket: basket.id });
    if (error) return { error: error.message };
    return { success: String(data) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const claimSchema = z.object({
  item_id: z.uuid(),
  type: z.enum(["damaged", "expired"]),
  qty: z.coerce.number().int().min(1).max(50),
  note: z.string().trim().max(300).optional(),
});

/** Damage/expiry claim with mandatory photo (stored privately as <user_id>/<uuid>.<ext>). */
export async function fileClaim(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireArea("resident");
  const parsed = claimSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { error: "A photo of the item is required" };
  if (photo.size > 5 * 1024 * 1024) return { error: "Photo must be under 5 MB" };
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[photo.type];
  if (!ext) return { error: "Photo must be a JPG, PNG or WebP image" };

  const supabase = await createClient();
  const path = `${ctx.userId}/${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("claim-photos").upload(path, photo, { contentType: photo.type });
  if (upErr) return { error: `Photo upload failed: ${upErr.message}` };

  const { error } = await supabase.rpc("file_damage_claim", {
    p_item: parsed.data.item_id,
    p_type: parsed.data.type,
    p_qty: parsed.data.qty,
    p_photo_path: path,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { success: "Claim submitted." };
}
