import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseEvent, signPayload, verifySignature, type GatewayEvent } from "./signing";

/**
 * Payment gateway adapter. Today every method is SIMULATED: the checkout page plays the
 * customer's side and posts a signed event to the same handler a real provider webhook would.
 * To go live, implement `createCheckout` for Raast / JazzCash / Easypaisa and point their
 * callbacks at /api/payments/webhook (translating their payload into a GatewayEvent).
 */

export const ONLINE_METHODS = ["raast", "jazzcash", "easypaisa"] as const;
export type OnlineMethod = (typeof ONLINE_METHODS)[number];

export const METHOD_INFO: Record<OnlineMethod, { label: string; labelUr: string; hint: string }> = {
  raast: { label: "Raast (bank transfer)", labelUr: "راست (بینک ٹرانسفر)", hint: "Pay from any Pakistani bank app to our Raast ID." },
  jazzcash: { label: "JazzCash", labelUr: "جاز کیش", hint: "Approve the request in your JazzCash app." },
  easypaisa: { label: "Easypaisa", labelUr: "ایزی پیسہ", hint: "Approve the request in your Easypaisa app." },
};

export const RAAST_ID = "CC-RAAST-0300-1234567";

function webhookSecret() {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_WEBHOOK_SECRET !== "1") {
    throw new Error("PAYMENT_WEBHOOK_SECRET must be set in production");
  }
  return "dev-only-insecure-secret";
}

/** Handle a (real or simulated) gateway webhook. Verifies the signature, then confirms in the DB. */
export async function handleGatewayEvent(body: string, signature: string | null) {
  if (!verifySignature(body, signature, webhookSecret())) return { ok: false as const, status: 401, error: "bad signature" };
  const event = parseEvent(body);
  if (!event) return { ok: false as const, status: 400, error: "malformed event" };

  const db = createAdminClient();
  const { data, error } = await db.rpc("confirm_payment", {
    p_provider_ref: event.provider_ref,
    p_amount: event.amount,
    p_success: event.status === "success",
  });
  if (error) return { ok: false as const, status: 422, error: error.message };
  return { ok: true as const, status: 200, state: data as string };
}

/** Used by the simulated checkout: build and sign the event the provider would send. */
export async function simulateGatewayCallback(e: Omit<GatewayEvent, "occurred_at">) {
  const body = JSON.stringify({ ...e, occurred_at: new Date().toISOString() });
  return handleGatewayEvent(body, signPayload(body, webhookSecret()));
}
