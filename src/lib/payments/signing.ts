import { createHmac, timingSafeEqual } from "node:crypto";

/** Gateway event delivered to /api/payments/webhook. */
export type GatewayEvent = {
  provider_ref: string;
  amount: number;
  status: "success" | "failed";
  method: string;
  occurred_at: string;
};

export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Constant-time signature check. */
export function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signPayload(body, secret), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function parseEvent(body: string): GatewayEvent | null {
  try {
    const e = JSON.parse(body) as Partial<GatewayEvent>;
    if (typeof e.provider_ref !== "string" || typeof e.amount !== "number" || (e.status !== "success" && e.status !== "failed")) {
      return null;
    }
    return e as GatewayEvent;
  } catch {
    return null;
  }
}
