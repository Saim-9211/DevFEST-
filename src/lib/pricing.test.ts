import { describe, expect, it } from "vitest";
import { basketTotals, depositSplit, leftoverUnits, lineMargin, meetsMinimum, toBulkUnits, unitSavings } from "./pricing";

describe("bulk conversion", () => {
  it("rounds household units up to whole bulk units", () => {
    expect(toBulkUnits(0, 5)).toBe(0);
    expect(toBulkUnits(5, 5)).toBe(1);
    expect(toBulkUnits(6, 5)).toBe(2);
  });
  it("computes surplus from rounding", () => {
    expect(leftoverUnits(6, 5)).toBe(4);
    expect(leftoverUnits(10, 5)).toBe(0);
  });
  it("rejects invalid split factors", () => {
    expect(() => toBulkUnits(3, 0)).toThrow();
  });
});

describe("basket", () => {
  // Same basket as the SQL test: 2 atta, 3 daal chana, 2 salt
  const lines = [
    { qty: 2, unit_price: 1260, retail_price: 1500 },
    { qty: 3, unit_price: 272, retail_price: 340 },
    { qty: 2, unit_price: 56, retail_price: 60 },
  ];
  it("totals and savings match the database", () => {
    const t = basketTotals(lines);
    expect(t.total).toBe(3448);
    expect(t.retail).toBe(4140);
    expect(t.savings).toBe(692);
    expect(t.savingsPct).toBeCloseTo(0.167, 3);
  });
  it("splits a 20% deposit rounded up, matching the SQL (3448 -> 690)", () => {
    expect(depositSplit(3448, 20)).toEqual({ deposit: 690, balance: 2758 });
  });
  it("charges upfront-only households 100%", () => {
    expect(depositSplit(3448, 20, true)).toEqual({ deposit: 3448, balance: 0 });
  });
  it("handles an empty basket", () => {
    expect(basketTotals([]).savingsPct).toBe(0);
    expect(depositSplit(0, 20)).toEqual({ deposit: 0, balance: 0 });
  });
});

describe("margin and savings", () => {
  it("computes per-unit savings", () => {
    expect(unitSavings(1500, 1260).pct).toBeCloseTo(0.16);
  });
  it("computes the platform spread from a bulk rate card", () => {
    const m = lineMargin(1260, 5796, 5); // 50 kg sack at 5,796 -> 1,159.20 per 10 kg bag
    expect(m.unitCost).toBeCloseTo(1159.2);
    expect(m.amount).toBeCloseTo(100.8);
    expect(m.pct).toBeCloseTo(0.08);
  });
});

describe("building minimum", () => {
  const min = { min_households: 8, min_order_value: 120000 };
  it("needs both households and value", () => {
    expect(meetsMinimum(9, 131000, min).met).toBe(true);
    expect(meetsMinimum(9, 100000, min).met).toBe(false);
    expect(meetsMinimum(5, 130000, min).met).toBe(false);
  });
  it("reports progress as the weaker measure", () => {
    const r = meetsMinimum(4, 90000, min);
    expect(r.progress).toBeCloseTo(0.5);
    expect(r.householdsShort).toBe(4);
    expect(r.valueShort).toBe(30000);
  });
});
