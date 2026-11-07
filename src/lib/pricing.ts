/**
 * Pricing math shared by the UI. Mirrors the SQL in supabase/migrations so the numbers on screen
 * match what the database stores (`_recalc_basket`, `run_cutoff`, `admin_cycle_kpis`).
 *
 * V2 model: each cycle has a fixed offer price per SKU. Residents pay a deposit (10-20%) when
 * ordering and the balance at pickup. The platform earns the spread between the offer price and
 * the wholesale cost. Savings are communicated per basket, not as a flat % per item.
 */

/** Bulk units a supplier must ship to cover `householdUnits` (always rounds up). */
export function toBulkUnits(householdUnits: number, splitFactor: number): number {
  if (splitFactor < 1) throw new Error("splitFactor must be >= 1");
  if (householdUnits <= 0) return 0;
  return Math.ceil(householdUnits / splitFactor);
}

/** Household units left over after rounding up to whole bulk units (surplus stock). */
export function leftoverUnits(householdUnits: number, splitFactor: number): number {
  return toBulkUnits(householdUnits, splitFactor) * splitFactor - Math.max(householdUnits, 0);
}

export type BasketLine = { qty: number; unit_price: number; retail_price: number };

/** Basket total, retail benchmark and savings. */
export function basketTotals(lines: BasketLine[]) {
  const total = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const retail = lines.reduce((s, l) => s + l.qty * l.retail_price, 0);
  const savings = retail - total;
  return { total, retail, savings, savingsPct: retail > 0 ? savings / retail : 0 };
}

/** Deposit (rounded up to the rupee) and balance due at pickup. Upfront-only households pay 100%. */
export function depositSplit(total: number, depositPct: number, upfront = false) {
  const deposit = upfront ? total : Math.ceil((total * depositPct) / 100);
  return { deposit, balance: Math.max(total - deposit, 0) };
}

/** Per-unit savings vs the retail benchmark. */
export function unitSavings(retailPrice: number, offerPrice: number) {
  return { amount: retailPrice - offerPrice, pct: retailPrice > 0 ? (retailPrice - offerPrice) / retailPrice : 0 };
}

/** Platform spread per household unit given a rate card. */
export function lineMargin(offerPrice: number, pricePerBulk: number, splitFactor: number) {
  const unitCost = pricePerBulk / splitFactor;
  const amount = offerPrice - unitCost;
  return { unitCost, amount, pct: offerPrice > 0 ? amount / offerPrice : 0 };
}

export type Minimum = { min_households: number; min_order_value: number };

/** Has a building reached this cycle's minimum? Progress is the weaker of the two measures. */
export function meetsMinimum(households: number, orderValue: number, min: Minimum) {
  const hh = min.min_households > 0 ? households / min.min_households : 1;
  const val = min.min_order_value > 0 ? orderValue / min.min_order_value : 1;
  return {
    met: households >= min.min_households && orderValue >= min.min_order_value,
    progress: Math.min(Math.min(hh, val), 1),
    householdsShort: Math.max(min.min_households - households, 0),
    valueShort: Math.max(min.min_order_value - orderValue, 0),
  };
}
