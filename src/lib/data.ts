import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type CycleStatus = keyof Dictionary["cycleStatus"];
export type BasketStatus = keyof Dictionary["basketStatus"];
export type BasketPaymentStatus = keyof Dictionary["paymentStatus"];

export type Cycle = {
  id: string;
  cluster_id: string;
  name: string;
  status: CycleStatus;
  open_at: string;
  cutoff_at: string;
  delivery_date: string;
  deposit_pct: number;
  min_order_value: number;
  min_households: number;
};

export type Basket = {
  id: string;
  cycle_id: string;
  user_id: string;
  building_id: string;
  status: BasketStatus;
  payment_status: BasketPaymentStatus;
  upfront_required: boolean;
  total: number;
  retail_total: number;
  deposit_due: number;
  amount_paid: number;
  balance_due: number;
  collected_at: string | null;
};

export type BasketItem = {
  id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  retail_price: number;
  product: { name_en: string; name_ur: string; household_unit_label: string; brand: string | null };
};

export type Progress = {
  households: number;
  pending: number;
  order_value: number;
  min_households: number;
  min_order_value: number;
  met_minimum: boolean;
};

const CYCLE_COLS = "id, cluster_id, name, status, open_at, cutoff_at, delivery_date, deposit_pct, min_order_value, min_households";
const BASKET_COLS =
  "id, cycle_id, user_id, building_id, status, payment_status, upfront_required, total, retail_total, deposit_due, amount_paid, balance_due, collected_at";

/** Postgres numerics arrive as strings through PostgREST; coerce the money fields. */
function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) if (out[k] != null) (out as Record<keyof T, unknown>)[k] = Number(out[k]);
  return out;
}

export const toCycle = (r: Record<string, unknown>) =>
  num(r, ["deposit_pct", "min_order_value", "min_households"]) as unknown as Cycle;
export const toBasket = (r: Record<string, unknown>) =>
  num(r, ["total", "retail_total", "deposit_due", "amount_paid", "balance_due"]) as unknown as Basket;

/** The live (not draft/closed/cancelled) cycle for a cluster, or the most recent one. */
export async function getCurrentCycle(clusterId: string | null): Promise<Cycle | null> {
  if (!clusterId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("buying_cycles")
    .select(CYCLE_COLS)
    .eq("cluster_id", clusterId)
    .not("status", "in", "(draft,cancelled)")
    .order("open_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toCycle(data) : null;
}

export async function getCycle(id: string): Promise<Cycle | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("buying_cycles").select(CYCLE_COLS).eq("id", id).maybeSingle();
  return data ? toCycle(data) : null;
}

export async function getMyBasket(cycleId: string, userId: string): Promise<Basket | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("baskets").select(BASKET_COLS).eq("cycle_id", cycleId).eq("user_id", userId).maybeSingle();
  return data ? toBasket(data) : null;
}

export async function getBasketItems(basketId: string): Promise<BasketItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("basket_items")
    .select("id, product_id, qty, unit_price, retail_price, product:products(name_en, name_ur, household_unit_label, brand)")
    .eq("basket_id", basketId)
    .order("created_at");
  return ((data ?? []) as unknown as BasketItem[]).map((i) => ({
    ...i,
    unit_price: Number(i.unit_price),
    retail_price: Number(i.retail_price),
  }));
}

export async function getBuildingProgress(cycleId: string, buildingId: string): Promise<Progress | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("building_progress", { p_cycle: cycleId, p_building: buildingId });
  const row = Array.isArray(data) ? data[0] : null;
  return row ? (num(row, ["households", "pending", "order_value", "min_households", "min_order_value"]) as Progress) : null;
}

export async function getCreditBalance(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("credit_balance");
  return Number(data ?? 0);
}

export const BASKET_ITEMS_LOCKED: BasketStatus[] = ["confirmed", "ready", "collected", "cancelled", "no_show"];
