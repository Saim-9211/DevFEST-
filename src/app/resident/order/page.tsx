import Link from "next/link";
import type { Metadata } from "next";
import { Check, Circle } from "lucide-react";
import { activeMembership, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { getBasketItems, getBuildingProgress, getCreditBalance, getCurrentCycle, getMyBasket, type Basket, type Cycle } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { METHOD_INFO, type OnlineMethod } from "@/lib/payments/gateway";
import { cn, formatPKR, isWithinHours } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { BuildingProgress } from "@/components/building-progress";
import { PayMethods } from "@/components/pay-methods";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, CardTitle, Field, Input, Notice, Select } from "@/components/ui/primitives";
import { applyCredit, fileClaim, payBalance } from "../actions";
import { PickupCode } from "./pickup-code";

export const metadata: Metadata = { title: "My order" };

const CYCLE_ORDER = ["open", "locked", "ordered", "dispatched", "delivered", "distributing", "closed"];

function steps(cycle: Cycle, basket: Basket) {
  const at = CYCLE_ORDER.indexOf(cycle.status);
  return [
    { label: "Order placed", done: basket.status !== "draft" },
    { label: "Deposit paid", done: ["deposit_paid", "paid_in_full"].includes(basket.payment_status) || ["collected", "no_show"].includes(basket.status) },
    { label: "Building minimum reached · cutoff", done: at >= 1 && basket.status !== "cancelled" },
    { label: "Ordered from wholesalers", done: at >= 2 && basket.status !== "cancelled" },
    { label: "On the way", done: at >= 3 && basket.status !== "cancelled" },
    { label: "Delivered to your building", done: at >= 4 && basket.status !== "cancelled" },
    { label: "Ready for pickup", done: ["ready", "collected"].includes(basket.status) },
    { label: "Collected", done: basket.status === "collected" },
  ];
}

export default async function OrderPage() {
  const ctx = await requireArea("resident");
  const { t, locale } = await getDictionary();
  const o = t.order;
  const m = activeMembership(ctx)!;
  if (m.status !== "approved") return <Notice>{t.resident.pendingBody}</Notice>;
  const cycle = await getCurrentCycle(m.building.cluster_id);
  const basket = cycle ? await getMyBasket(cycle.id, ctx.userId) : null;
  if (!cycle || !basket || basket.status === "draft") {
    return (
      <Card className="space-y-3 text-center">
        <p className="text-muted-foreground">{t.basket.empty}</p>
        <Link href="/resident/catalog" className={buttonClass("primary")}>
          {t.basket.browse}
        </Link>
      </Card>
    );
  }

  const supabase = await createClient();
  const [items, progress, credit, { data: payments }, { data: claims }, { data: lastNote }] = await Promise.all([
    getBasketItems(basket.id),
    getBuildingProgress(cycle.id, m.building_id),
    getCreditBalance(),
    supabase.from("payments").select("id, kind, method, amount, state, receipt_no, created_at").eq("basket_id", basket.id).order("created_at"),
    supabase.from("disputes").select("id, type, qty, claim_amount, route, status, created_at, basket_item_id"),
    supabase.from("notifications").select("body").in("type", ["refunded", "cancelled"]).order("created_at", { ascending: false }).limit(1),
  ]);
  const name = (i: (typeof items)[number]) => (locale === "ur" ? i.product.name_ur : i.product.name_en);
  const claimWindowOpen = basket.status === "collected" && isWithinHours(basket.collected_at, 48);
  const itemName = new Map(items.map((i) => [i.id, name(i)]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{o.title}</h1>
        <div className="flex gap-2">
          <Badge tone={basket.status === "cancelled" || basket.status === "no_show" ? "danger" : "brand"}>{t.basketStatus[basket.status]}</Badge>
          <Badge>{t.paymentStatus[basket.payment_status]}</Badge>
        </div>
      </div>

      {basket.status === "cancelled" ? <Notice tone="error">{lastNote?.[0]?.body ?? t.basketStatus.cancelled}</Notice> : null}
      {basket.status === "pending_deposit" ? (
        <Notice>
          {t.basket.deposit}: {formatPKR(basket.deposit_due - basket.amount_paid, locale)} ·{" "}
          <Link href="/resident/basket" className="font-medium text-brand underline">
            {t.basket.payDeposit}
          </Link>
        </Notice>
      ) : null}
      {progress && cycle.status === "open" ? <BuildingProgress p={progress} t={t} locale={locale} /> : null}

      {/* Pickup */}
      {basket.status === "ready" ? (
        <Card className="space-y-4 border-brand/40">
          <CardTitle>{o.pickupTitle}</CardTitle>
          {basket.payment_status !== "paid_in_full" ? (
            <>
              <p className="text-sm">
                {t.ambassador.balanceDue}: <strong className="text-lg">{formatPKR(basket.balance_due, locale)}</strong>
              </p>
              {credit > 0 ? (
                <form action={applyCredit}>
                  <Button variant="secondary" size="sm">
                    {t.basket.useCredit} ({formatPKR(credit, locale)})
                  </Button>
                </form>
              ) : null}
              <ActionForm action={payBalance}>
                <PayMethods locale={locale} />
                <SubmitButton className="w-full">
                  {o.payBalance} · {formatPKR(basket.balance_due, locale)}
                </SubmitButton>
              </ActionForm>
              <p className="text-sm text-muted-foreground">{o.payCash}</p>
            </>
          ) : (
            <Notice tone="success">{o.paidInFull}</Notice>
          )}
          <PickupCode basketId={basket.id} labels={{ show: o.showCode, hint: o.codeHint }} />
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>{o.timeline}</CardTitle>
          <ol className="space-y-2">
            {steps(cycle, basket).map((s) => (
              <li key={s.label} className={cn("flex items-center gap-2 text-sm", s.done ? "text-foreground" : "text-muted-foreground")}>
                {s.done ? <Check className="size-4 text-brand" aria-hidden /> : <Circle className="size-4" aria-hidden />}
                {s.label}
              </li>
            ))}
          </ol>
        </Card>

        <Card className="space-y-2">
          <CardTitle>{t.basket.title}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {name(i)} × {i.qty}
                </span>
                <span>{formatPKR(i.qty * i.unit_price, locale)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>{t.basket.total}</span>
            <span>{formatPKR(basket.total, locale)}</span>
          </p>
          <p className="text-sm text-brand">
            {t.basket.youSave} {formatPKR(basket.retail_total - basket.total, locale)}
          </p>
        </Card>
      </div>

      <Card className="space-y-2">
        <CardTitle>{o.payments}</CardTitle>
        <ul className="divide-y divide-border text-sm">
          {(payments ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {p.kind === "refund" ? o.refund : p.kind === "deposit" ? t.basket.deposit : t.basket.balance} ·{" "}
                {p.method === "cash_agent" ? "Cash (agent)" : p.method === "credit" ? t.resident.credit : METHOD_INFO[p.method as OnlineMethod]?.label}
                {p.receipt_no ? ` · ${p.receipt_no}` : ""}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={p.state === "verified" ? "brand" : p.state === "failed" ? "danger" : "neutral"}>{p.state}</Badge>
                <strong>
                  {p.kind === "refund" ? "−" : ""}
                  {formatPKR(Number(p.amount), locale)}
                </strong>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {claimWindowOpen ? (
        <Card className="space-y-3">
          <CardTitle>{o.claimTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">{o.claimHint}</p>
          <ActionForm action={fileClaim}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.basket.item}>
                <Select name="item_id" required>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {name(i)} (× {i.qty}, {formatPKR(i.unit_price, locale)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={o.claimType}>
                <Select name="type">
                  <option value="damaged">{o.damaged}</option>
                  <option value="expired">{o.expired}</option>
                </Select>
              </Field>
              <Field label={t.basket.qty}>
                <Input name="qty" type="number" min={1} max={50} defaultValue={1} required />
              </Field>
              <Field label={o.photo}>
                <Input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required className="pt-1.5" />
              </Field>
            </div>
            <Input name="note" placeholder="Note (optional)" maxLength={300} />
            <SubmitButton>{o.fileClaim}</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {(claims ?? []).length > 0 ? (
        <Card className="space-y-2">
          <CardTitle>{o.claims}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {(claims ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {itemName.get(c.basket_item_id) ?? "Item"} × {c.qty} · {c.type === "damaged" ? o.damaged : o.expired}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={c.status === "refunded" ? "brand" : c.status === "rejected" ? "danger" : "warn"}>
                    {c.route === "auto_refund" ? "Instant credit" : c.status}
                  </Badge>
                  {formatPKR(Number(c.claim_amount), locale)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
