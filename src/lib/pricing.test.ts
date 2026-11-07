import { describe, expect, it } from "vitest";
import {
  currentTier,
  estimateUnitPrice,
  finalHouseholdPrice,
  leftoverUnits,
  nextTier,
  savings,
  tierProgress,
  toBulkUnits,
} from "./pricing";

// Mirrors the seed: Chakki Atta 10 kg, retail 1450, split 5 (50 kg sack)
const tiers = [
  { min_bulk_units: 0, est_unit_price: 1378 },
  { min_bulk_units: 5, est_unit_price: 1276 },
  { min_bulk_units: 20, est_unit_price: 1160 },
];

describe("bulk conversion", () => {
  it("rounds household units up to whole bulk units", () => {
    expect(toBulkUnits(0, 5)).toBe(0);
    expect(toBulkUnits(1, 5)).toBe(1);
    expect(toBulkUnits(5, 5)).toBe(1);
    expect(toBulkUnits(6, 5)).toBe(2);
    expect(toBulkUnits(1200 / 10, 5)).toBe(24); // 1,200 kg of atta in 10 kg bags -> 24 sacks
  });
  it("computes leftovers from rounding", () => {
    expect(leftoverUnits(6, 5)).toBe(4);
    expect(leftoverUnits(10, 5)).toBe(0);
    expect(leftoverUnits(0, 5)).toBe(0);
  });
  it("rejects invalid split factors", () => {
    expect(() => toBulkUnits(3, 0)).toThrow();
  });
});

describe("tiers", () => {
  it("picks the highest tier whose threshold is met", () => {
    expect(currentTier(tiers, 0)?.est_unit_price).toBe(1378);
    expect(currentTier(tiers, 4)?.est_unit_price).toBe(1378);
    expect(currentTier(tiers, 5)?.est_unit_price).toBe(1276);
    expect(currentTier(tiers, 50)?.est_unit_price).toBe(1160);
  });
  it("finds the next tier", () => {
    expect(nextTier(tiers, 0)?.min_bulk_units).toBe(5);
    expect(nextTier(tiers, 20)).toBeUndefined();
  });
  it("falls back to retail when no tiers exist", () => {
    expect(estimateUnitPrice([], 10, 1450)).toBe(1450);
  });
  it("matches the SQL test case: 25 bags = 5 sacks = tier 1", () => {
    expect(estimateUnitPrice(tiers, toBulkUnits(25, 5), 1450)).toBe(1276);
  });
  it("reports progress toward the next tier", () => {
    const p = tierProgress(tiers, 20, 5); // 4 sacks, next tier at 5 sacks (25 bags)
    expect(p.unitsToNext).toBe(5);
    expect(p.next?.min_bulk_units).toBe(5);
    expect(p.progress).toBeCloseTo(20 / 25);
    expect(tierProgress(tiers, 500, 5).progress).toBe(1);
  });
});

describe("savings and final price", () => {
  it("computes savings vs retail", () => {
    const s = savings(1450, 1160, 2);
    expect(s.amount).toBe(580);
    expect(s.pct).toBeCloseTo(0.2);
  });
  it("splits a bulk bid per household and adds the service fee", () => {
    // 5,600 per 50 kg sack -> 1,120 per 10 kg bag, + 2.5% fee = 1,148
    expect(finalHouseholdPrice(5600, 5, 2.5)).toBe(1148);
  });
});
