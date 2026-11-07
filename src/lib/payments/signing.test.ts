import { describe, expect, it } from "vitest";
import { parseEvent, signPayload, verifySignature } from "./signing";

const secret = "test-secret";
const body = JSON.stringify({ provider_ref: "CC-ABC", amount: 690, status: "success", method: "raast", occurred_at: "now" });

describe("webhook signing", () => {
  it("accepts a correctly signed body", () => {
    expect(verifySignature(body, signPayload(body, secret), secret)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets and missing or garbage signatures", () => {
    const sig = signPayload(body, secret);
    expect(verifySignature(body.replace("690", "1"), sig, secret)).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "zz", secret)).toBe(false);
  });
  it("parses only well-formed events", () => {
    expect(parseEvent(body)?.amount).toBe(690);
    expect(parseEvent("{}")).toBeNull();
    expect(parseEvent("not json")).toBeNull();
  });
});
