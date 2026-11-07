import { describe, expect, it } from "vitest";
import { normalizePkPhone } from "./phone";

describe("normalizePkPhone", () => {
  it("accepts local, international and spaced formats", () => {
    expect(normalizePkPhone("03001234567")).toBe("+923001234567");
    expect(normalizePkPhone("0300-1234567")).toBe("+923001234567");
    expect(normalizePkPhone("+92 300 1234567")).toBe("+923001234567");
    expect(normalizePkPhone("923001234567")).toBe("+923001234567");
  });
  it("rejects landlines and malformed numbers", () => {
    expect(normalizePkPhone("0421234567")).toBeNull();
    expect(normalizePkPhone("0300123")).toBeNull();
    expect(normalizePkPhone("abc")).toBeNull();
  });
});
