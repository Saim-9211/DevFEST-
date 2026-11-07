import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { activeMembership, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { getBasketItems, getCreditBalance, getCurrentCycle, getMyBasket } from "@/lib/data";
import { basketTotals, depositSplit } from "@/lib/pricing";
import { formatPKR, formatPct } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { PayMethods } from "@/components/pay-methods";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardTitle, Input, Notice } from "@/components/ui/primitives";
import { applyCredit, placeOrderAndPay, setItemQty } from "../actions";

export const metadata: Metadata = { title: "My basket" };

export default async function BasketPage() {
  const ctx = await requireArea("resident");
  const { t, locale } = await getDictionary();
  const b = t.basket;
  const m = activeMembership(ctx)!;
  if (m.status !== "approved") return <Notice>{t.resident.pendingBody}</Notice>;

  const cycle = await getCurrentCycle(m.building.cluster_id);
  if (!cycle) return <Notice>{t.resident.noCycle}</Notice>;
  const basket = await getMyBasket(cycle.id, ctx.userId);
  if (basket && !["draft", "pending_deposit"].includes(basket.status)) redirect("/resident/order");

  const items = basket ? await getBasketItems(basket.id) : [];
  const credit = await getCreditBalance();
  const totals = basketTotals(items);
  const split = depositSplit(totals.total, cycle.deposit_pct, basket?.upfront_required ?? ctx.profile.upfront_only);
  const open = cycle.status === "open" && new Date(cycle.cutoff_at) > new Date();
  const name = (i: (typeof items)[number]) => (locale === "ur" ? i.product.name_ur : i.product.name_en);

  if (!basket || items.length === 0) {
    return (
      <Card className="space-y-3 text-center">
        <p className="text-muted-foreground">{b.empty}</p>
        <Link href="/resident/catalog" className={buttonClass("primary")}>
          {b.browse}
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{b.title}</h1>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-start text-muted-foreground">
            <tr>
              <th className="p-3 text-start font-medium">{b.item}</th>
              <th className="p-3 text-start font-medium">{b.qty}</th>
              <th className="p-3 text-end font-medium">Rs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="p-3">
                  <p className="font-medium">{name(i)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPKR(i.unit_price, locale)} <span className="line-through">{formatPKR(i.retail_price, locale)}</span>
                  </p>
                </td>
                <td className="p-3">
                  {open ? (
                    <form action={setItemQty.bind(null, i.product_id)} className="flex items-center gap-1">
                      <Input name="qty" type="number" min={0} max={50} defaultValue={i.qty} className="h-8 w-16" aria-label={b.qty} />
                      <Button size="sm" variant="ghost">
                        ✓
                      </Button>
                    </form>
                  ) : (
                    i.qty
                  )}
                </td>
                <td className="p-3 text-end font-medium">{formatPKR(i.qty * i.unit_price, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-2">
        <Row label={b.retailTotal} value={<span className="line-through">{formatPKR(totals.retail, locale)}</span>} />
        <Row label={b.total} value={<strong className="text-lg">{formatPKR(totals.total, locale)}</strong>} />
        <Row
          label={b.youSave}
          value={
            <strong className="text-brand">
              {formatPKR(totals.savings, locale)} ({formatPct(totals.savingsPct)})
            </strong>
          }
        />
        <hr className="border-border" />
        <Row label={`${b.deposit} (${basket.upfront_required ? 100 : cycle.deposit_pct}%)`} value={<strong>{formatPKR(split.deposit, locale)}</strong>} />
        {basket.amount_paid > 0 ? <Row label="Paid so far" value={formatPKR(basket.amount_paid, locale)} /> : null}
        <Row label={b.balance} value={formatPKR(split.balance, locale)} />
        <p className="pt-1 text-xs text-muted-foreground">{b.depositNote}</p>
      </Card>

      {open ? (
        <Card className="space-y-4">
          <CardTitle>{basket.status === "draft" ? b.placeOrder : b.payDeposit}</CardTitle>
          {credit > 0 && basket.status === "pending_deposit" ? (
            <form action={applyCredit}>
              <Button variant="secondary" size="sm">
                {b.useCredit} ({formatPKR(credit, locale)})
              </Button>
            </form>
          ) : null}
          <ActionForm action={placeOrderAndPay}>
            <p className="text-sm font-medium">{b.payWith}</p>
            <PayMethods locale={locale} />
            <SubmitButton className="w-full">
              {basket.status === "draft" ? b.placeOrder : b.payDeposit} · {formatPKR(Math.max(split.deposit - basket.amount_paid, 0), locale)}
            </SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <Notice>{t.catalog.closed}</Notice>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
