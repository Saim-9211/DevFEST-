import Link from "next/link";
import type { Metadata } from "next";
import { activeMembership, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { getBasketItems, getCurrentCycle, getMyBasket } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { basketTotals, unitSavings } from "@/lib/pricing";
import { formatPKR, formatPct } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, Input, Notice } from "@/components/ui/primitives";
import { setItemQty } from "../actions";

export const metadata: Metadata = { title: "Order staples" };

type OfferRow = {
  offer_price: number;
  product: {
    id: string;
    name_en: string;
    name_ur: string;
    brand: string | null;
    household_unit_label: string;
    reference_retail_price: number;
    category: { slug: string; name_en: string; name_ur: string; sort: number };
  };
};

export default async function CatalogPage() {
  const ctx = await requireArea("resident");
  const { t, locale } = await getDictionary();
  const c = t.catalog;
  const m = activeMembership(ctx)!;
  if (m.status !== "approved") return <Notice>{t.resident.pendingBody}</Notice>;

  const cycle = await getCurrentCycle(m.building.cluster_id);
  if (!cycle) return <Notice>{t.resident.noCycle}</Notice>;

  const supabase = await createClient();
  const [{ data: offers }, basket] = await Promise.all([
    supabase
      .from("cycle_offers")
      .select(
        "offer_price, product:products(id, name_en, name_ur, brand, household_unit_label, reference_retail_price, category:categories(slug, name_en, name_ur, sort))",
      )
      .eq("cycle_id", cycle.id)
      .eq("active", true),
    getMyBasket(cycle.id, ctx.userId),
  ]);
  const items = basket ? await getBasketItems(basket.id) : [];
  const qtyBy = new Map(items.map((i) => [i.product_id, i.qty]));
  const totals = basketTotals(items);
  const editable = cycle.status === "open" && new Date(cycle.cutoff_at) > new Date() && (!basket || ["draft", "pending_deposit"].includes(basket.status));

  // Group by category
  const rows = ((offers ?? []) as unknown as OfferRow[]).filter((o) => o.product);
  const groups = new Map<string, { name: string; sort: number; rows: OfferRow[] }>();
  for (const o of rows) {
    const cat = o.product.category;
    const g = groups.get(cat.slug) ?? { name: locale === "ur" ? cat.name_ur : cat.name_en, sort: cat.sort, rows: [] };
    g.rows.push(o);
    groups.set(cat.slug, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.sort - b.sort);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.title}</h1>
          <p className="text-muted-foreground">{cycle.name}</p>
        </div>
        {!editable ? <Notice>{basket && basket.status !== "draft" && basket.status !== "pending_deposit" ? c.locked : c.closed}</Notice> : null}
      </div>

      {sorted.map((g) => (
        <section key={g.name} className="space-y-3">
          <h2 className="text-lg font-semibold">{g.name}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.rows.map((o) => {
              const p = o.product;
              const offer = Number(o.offer_price);
              const retail = Number(p.reference_retail_price);
              const s = unitSavings(retail, offer);
              const qty = qtyBy.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <Card className="flex h-full flex-col justify-between gap-3 p-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{locale === "ur" ? p.name_ur : p.name_en}</p>
                        {s.pct >= 0.01 ? <Badge tone="brand">{c.save} {formatPct(s.pct)}</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.brand ? `${p.brand} · ` : ""}
                        {p.household_unit_label}
                      </p>
                      <p className="mt-2">
                        <span className="text-lg font-semibold">{formatPKR(offer, locale)}</span>{" "}
                        <span className="text-sm text-muted-foreground line-through">{formatPKR(retail, locale)}</span>
                      </p>
                    </div>
                    {editable ? (
                      <form action={setItemQty.bind(null, p.id)} className="flex items-center gap-2">
                        <Input
                          name="qty"
                          type="number"
                          min={0}
                          max={50}
                          defaultValue={qty || 1}
                          aria-label={t.basket.qty}
                          className="w-20"
                        />
                        <button className={buttonClass(qty ? "secondary" : "primary", "sm")}>{qty ? c.update : c.add}</button>
                        {qty ? <span className="text-sm text-brand">× {qty}</span> : null}
                      </form>
                    ) : qty ? (
                      <p className="text-sm text-brand">× {qty}</p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {items.length > 0 ? (
        <div className="sticky bottom-4">
          <Card className="flex flex-wrap items-center justify-between gap-3 border-brand/40 shadow-lg">
            <p className="text-sm">
              {t.basket.total}: <strong>{formatPKR(totals.total, locale)}</strong> · {t.basket.youSave}{" "}
              <strong className="text-brand">
                {formatPKR(totals.savings, locale)} ({formatPct(totals.savingsPct)})
              </strong>
            </p>
            <Link href="/resident/basket" className={buttonClass("primary")}>
              {t.basket.title} →
            </Link>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
