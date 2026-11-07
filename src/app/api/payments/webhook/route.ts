import { NextResponse, type NextRequest } from "next/server";
import { handleGatewayEvent } from "@/lib/payments/gateway";

/** Payment provider callback. Body must be signed with PAYMENT_WEBHOOK_SECRET (HMAC-SHA256, hex). */
export async function POST(request: NextRequest) {
  const body = await request.text();
  try {
    const result = await handleGatewayEvent(body, request.headers.get("x-signature"));
    return NextResponse.json(result, { status: result.status });
  } catch (e) {
    // Missing secret / service key: a configuration problem, not a client error.
    console.error("payment webhook misconfigured:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "payments not configured" }, { status: 503 });
  }
}
