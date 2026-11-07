import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Smartphone, XCircle } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { METHOD_INFO, RAAST_ID, type OnlineMethod } from "@/lib/payments/gateway";
import { formatPKR } from "@/lib/utils";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, Notice } from "@/components/ui/primitives";
import { completeMockPayment } from "../../actions";

export const metadata: Metadata = { title: "Payment" };

/** Simulated gateway checkout (Raast / JazzCash / Easypaisa). */
export default async function PayPage({ params }: PageProps<"/resident/pay/[id]">) {
  const ctx = await requireArea("resident");
  const { locale } = await getDictionary();
  const { id } = await params;
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("payments")
    .select("id, kind, method, amount, state, provider_ref, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!p || p.user_id !== ctx.userId) notFound();

  const method = p.method as OnlineMethod;
  const info = METHOD_INFO[method];
  const amount = formatPKR(Number(p.amount), locale);
  const back = p.kind === "deposit" ? "/resident" : "/resident/order";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Notice>Demo checkout: no real money moves. This screen simulates the {info?.label ?? p.method} app.</Notice>
      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{locale === "ur" ? info?.labelUr : info?.label}</h1>
          <Badge tone={p.state === "verified" ? "brand" : p.state === "failed" ? "danger" : "warn"}>{p.state}</Badge>
        </div>
        <div className="rounded-lg bg-muted p-4 text-sm">
          <p className="text-muted-foreground">CollectiveCart · {p.kind === "deposit" ? "Order deposit" : "Order balance"}</p>
          <p className="mt-1 text-3xl font-bold">{amount}</p>
          <p className="mt-2 font-mono text-xs">Ref: {p.provider_ref}</p>
        </div>

        {p.state === "pending" ? (
          <>
            {method === "raast" ? (
              <div className="space-y-1 text-sm">
                <p>
                  Send <strong>{amount}</strong> to Raast ID <strong className="font-mono">{RAAST_ID}</strong>
                </p>
                <p className="text-muted-foreground">Use reference {p.provider_ref} so we can match your payment.</p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <Smartphone className="size-4 text-brand" aria-hidden />A payment request was sent to {ctx.profile.phone ?? "your phone"}. Approve it in the app.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <form action={completeMockPayment.bind(null, p.id, "success")}>
                <Button className="w-full">Approve payment</Button>
              </form>
              <form action={completeMockPayment.bind(null, p.id, "failed")}>
                <Button variant="secondary" className="w-full">
                  Decline
                </Button>
              </form>
            </div>
          </>
        ) : p.state === "verified" ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto size-10 text-brand" aria-hidden />
            <p className="font-medium">Payment received</p>
            <Link href={back} className={buttonClass("primary")}>
              Continue
            </Link>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <XCircle className="mx-auto size-10 text-danger" aria-hidden />
            <p className="font-medium">Payment {p.state}</p>
            <Link href={p.kind === "deposit" ? "/resident/basket" : "/resident/order"} className={buttonClass("secondary")}>
              Try again
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
