/**
 * Pricing math shared by the UI. Mirrors the SQL functions `estimate_unit_price`
 * and `price_basket_item` in supabase/migrations so the numbers on screen match
 * what the database stores.
 *
 * Units:
 *  - household unit: what a family orders (e.g. a 10 kg atta bag)
 *  - bulk unit: what a supplier sells (e.g. a 50 kg sack = 5 household units)
 */

export type PriceTier = { min_bulk_units: number; est_unit_price: number };

/** Bulk units a supplier must ship to cover `householdUnits` (always rounds up). */
export function toBulkUnits(householdUnits: number, splitFactor: number): number {
  if (splitFactor < 1) throw new Error("splitFactor must be >= 1");
  if (householdUnits <= 0) return 0;
  return Math.ceil(householdUnits / splitFactor);
}

/** Household units left over after rounding up to whole bulk units. */
export function leftoverUnits(householdUnits: number, splitFactor: number): number {
  return toBulkUnits(householdUnits, splitFactor) * splitFactor - Math.max(householdUnits, 0);
}

/** Highest tier whose threshold is met, or undefined if none applies. */
export function currentTier(tiers: PriceTier[], bulkUnits: number): PriceTier | undefined {
  return [...tiers]
    .sort((a, b) => b.min_bulk_units - a.min_bulk_units)
    .find((t) => t.min_bulk_units <= Math.max(bulkUnits, 0));
}

/** The next cheaper tier above the current demand, if any. */
export function nextTier(tiers: PriceTier[], bulkUnits: number): PriceTier | undefined {
  return [...tiers]
    .sort((a, b) => a.min_bulk_units - b.min_bulk_units)
    .find((t) => t.min_bulk_units > Math.max(bulkUnits, 0));
}

/** Estimated price per household unit; falls back to the retail benchmark. */
export function estimateUnitPrice(
  tiers: PriceTier[],
  bulkUnits: number,
  referenceRetailPrice: number,
): number {
  return currentTier(tiers, bulkUnits)?.est_unit_price ?? referenceRetailPrice;
}

/**
 * Progress (0..1) from the current tier threshold toward the next one, plus how many
 * more household units the cluster needs to unlock it.
 */
export function tierProgress(tiers: PriceTier[], householdUnits: number, splitFactor: number) {
  const bulk = toBulkUnits(householdUnits, splitFactor);
  const next = nextTier(tiers, bulk);
  if (!next) return { progress: 1, unitsToNext: 0, next: undefined };
  const fromBulk = currentTier(tiers, bulk)?.min_bulk_units ?? 0;
  const fromUnits = fromBulk * splitFactor;
  const toUnits = next.min_bulk_units * splitFactor;
  const span = Math.max(toUnits - fromUnits, 1);
  return {
    progress: Math.min(Math.max((householdUnits - fromUnits) / span, 0), 1),
    unitsToNext: Math.max(toUnits - householdUnits, 0),
    next,
  };
}

/** Savings vs the retail benchmark, in PKR and as a fraction (0.2 = 20%). */
export function savings(referenceRetailPrice: number, unitPrice: number, qty = 1) {
  const amount = (referenceRetailPrice - unitPrice) * qty;
  const pct = referenceRetailPrice > 0 ? (referenceRetailPrice - unitPrice) / referenceRetailPrice : 0;
  return { amount, pct };
}

/** Final per-household price after award: bulk bid split across households plus the service fee. */
export function finalHouseholdPrice(bidUnitPriceBulk: number, splitFactor: number, serviceFeePct: number) {
  const base = bidUnitPriceBulk / splitFactor;
  return Math.round(base * (1 + serviceFeePct / 100) * 100) / 100;
}
