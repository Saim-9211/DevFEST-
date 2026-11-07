import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCycle } from "@/lib/data";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { lineMargin } from "@/lib/pricing";
import { formatPKR, formatPct } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Input, Select } from "@/components/ui/primitives";
import { saveOffer, selectQuote } from "../../actions";
import { CycleActions } from "../../cycle-actions";
import { KpiGrid, type Kpis } from "../../kpis";

export const metadata: Metadata = { title: "Cycle" };

type Quote = { id: string; product_id: string; price_per_bulk: number; min_bulk_units: number; max_bulk_units: number | null; supplier: { business_name: string; verified: boolean } };
type Lot = { id: string; product_id: string; total_household_units: number; bulk_units: number; leftover_units: number; revenue: number; quote_id: string | null };
type Product = { id: string; name_en: string; brand: string | null; branded: boolean; split_factor: number; bulk_unit_label: string; reference_retail_price: number };

export default async function CycleDetail({ params }: PageProps<"/admin/cycles/[id]">) {
  await requireArea("admin");
  const { id } = await params;
  const cycle = await getCycle(id);
  if (!cycle) notFound();
  const supabase = await createClient();

  const [{ data: kpis }, { data: results }, { data: buildings }, { data: lotRows }, { data: quoteRows }, { data: offerRows }, { data: productRows }, { data: events }] =
    await Promise.all([
      supabase.rpc("admin_cycle_kpis", { p_cycle: id }),
      supabase.from("building_cycle_status").select("building_id, households, order_value, met_minimum").eq("cycle_id", id),
      supabase.from("buildings").select("id, name").eq("cluster_id", cycle.cluster_id).order("name"),
      supabase.from("demand_lots").select("id, product_id, total_household_units, bulk_units, leftover_units, revenue, quote_id").eq("cycle_id", id),
      supabase.from("supplier_quotes").select("id, product_id, price_per_bulk, min_bulk_units, max_bulk_units, supplier:suppliers(business_name, verified)").eq("cycle_id", id),
      supabase.from("cycle_offers").select("product_id, offer_price").eq("cycle_id", id),
      supabase.from("products").select("id, name_en, brand, branded, split_factor, bulk_unit_label, reference_retail_price").eq("active", true).order("name_en"),
      supabase.from("cycle_events").select("id, from_status, to_status, note, created_at").eq("cycle_id", id).order("created_at"),
    ]);

  const products = new Map(((productRows ?? []) as Product[]).map((p) => [p.id, { ...p, reference_retail_price: Number(p.reference_retail_price) }]));
  const quotes = (quoteRows ?? []) as unknown as Quote[];
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const offers = new Map((offerRows ?? []).map((o) => [o.product_id, Number(o.offer_price)]));
  const resultBy = new Map((results ?? []).map((r) => [r.building_id, r]));
  const bestCost = (pid: string) => {
    const p = products.get(pid)!;
    const costs = quotes.filter((q) => q.product_id === pid && q.supplier.verified).map((q) => Number(q.price_per_bulk) / p.split_factor);
    return costs.length ? Math.min(...costs) : null;
  };
  const editableOffers = ["draft", "open"].includes(cycle.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{cycle.name}</h1>
          <p className="text-sm text-muted-foreground">
            Cutoff {new Date(cycle.cutoff_at).toLocaleString("en-PK")} · delivery {cycle.delivery_date} · deposit {cycle.deposit_pct}% · minimum{" "}
            {cycle.min_households} households and {formatPKR(cycle.min_order_value)} per building
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="brand">{dictionaries.en.cycleStatus[cycle.status]}</Badge>
          <CycleActions cycleId={cycle.id} status={cycle.status} />
        </div>
      </div>

      {kpis ? <KpiGrid k={kpis as Kpis} /> : null}

      {/* Buildings vs minimum */}
      <Card className="space-y-3">
        <CardTitle>Buildings vs minimum</CardTitle>
        <ul className="divide-y divide-border text-sm">
          {(buildings ?? []).map((b) => {
            const r = resultBy.get(b.id);
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{b.name}</span>
                {r ? (
                  <span className="flex items-center gap-2">
                    {r.households} households · {formatPKR(Number(r.order_value))}
                    <Badge tone={r.met_minimum ? "brand" : "danger"}>{r.met_minimum ? "Met: ordering" : "Missed: refunded"}</Badge>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Evaluated at cutoff</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Lots & suppliers */}
      {(lotRows ?? []).length > 0 ? (
        <Card className="space-y-3 overflow-x-auto">
          <CardTitle>Demand lots · supplier selection</CardTitle>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="p-2 text-start font-medium">Product</th>
                <th className="p-2 text-start font-medium">Units → bulk (surplus)</th>
                <th className="p-2 text-start font-medium">Revenue</th>
                <th className="p-2 text-start font-medium">Supplier · margin on sold units</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {((lotRows ?? []) as Lot[]).map((l) => {
                const p = products.get(l.product_id);
                const q = l.quote_id ? quoteById.get(l.quote_id) : undefined;
                const offer = offers.get(l.product_id) ?? 0;
                const m = q && p ? lineMargin(offer, Number(q.price_per_bulk), p.split_factor) : null;
                const candidates = quotes.filter(
                  (x) => x.product_id === l.product_id && x.supplier.verified && x.min_bulk_units <= l.bulk_units && (x.max_bulk_units == null || x.max_bulk_units >= l.bulk_units),
                );
                return (
                  <tr key={l.id}>
                    <td className="p-2">{p?.name_en}</td>
                    <td className="p-2">
                      {l.total_household_units} → {l.bulk_units} × {p?.bulk_unit_label} {l.leftover_units ? <span className="text-accent">(+{l.leftover_units})</span> : null}
                    </td>
                    <td className="p-2">{formatPKR(Number(l.revenue))}</td>
                    <td className="p-2">
                      {cycle.status === "locked" ? (
                        <form action={selectQuote.bind(null, cycle.id, l.id)} className="flex items-center gap-1.5">
                          <Select name="quote_id" defaultValue={l.quote_id ?? ""} className="h-8 w-auto">
                            {!l.quote_id ? <option value="">No supplier</option> : null}
                            {candidates.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.supplier.business_name} · {formatPKR(Number(x.price_per_bulk))}
                              </option>
                            ))}
                          </Select>
                          <Button size="sm" variant="secondary">
                            Set
                          </Button>
                        </form>
                      ) : (
                        q?.supplier.business_name ?? <Badge tone="danger">none</Badge>
                      )}
                      {m ? (
                        <span className={m.amount >= 0 ? "text-brand" : "text-danger"}>
                          {" "}
                          {formatPKR(m.amount * l.total_household_units)} ({formatPct(m.pct)})
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {/* Offers */}
      <Card className="space-y-3 overflow-x-auto">
        <CardTitle>Offer prices {editableOffers ? "(editable until cutoff)" : ""}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Offers can&apos;t go below the best verified wholesale cost (loss guard). Branded goods carry thin wholesale margins, so keep their discount small.
        </p>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="p-2 text-start font-medium">Product</th>
              <th className="p-2 text-start font-medium">Retail</th>
              <th className="p-2 text-start font-medium">Best cost / unit</th>
              <th className="p-2 text-start font-medium">Offer · resident saves · our margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...products.values()].map((p) => {
              const offer = offers.get(p.id);
              const cost = bestCost(p.id);
              return (
                <tr key={p.id}>
                  <td className="p-2">
                    {p.name_en} {p.branded ? <Badge>branded</Badge> : null}
                  </td>
                  <td className="p-2">{formatPKR(p.reference_retail_price)}</td>
                  <td className="p-2">{cost != null ? formatPKR(cost) : "—"}</td>
                  <td className="p-2">
                    {editableOffers ? (
                      <ActionForm action={saveOffer.bind(null, cycle.id, p.id)} className="flex flex-wrap items-center gap-1.5">
                        <Input name="offer_price" type="number" step="1" min="1" defaultValue={offer ?? ""} className="h-8 w-24" aria-label="Offer price" />
                        <SubmitButton variant="secondary">Save</SubmitButton>
                      </ActionForm>
                    ) : (
                      formatPKR(offer ?? 0)
                    )}
                    {offer ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        saves {formatPct((p.reference_retail_price - offer) / p.reference_retail_price)}
                        {cost != null ? ` · margin ${formatPct((offer - cost) / offer)}` : ""}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-2">
        <CardTitle>Audit log</CardTitle>
        <ul className="space-y-1 text-sm">
          {(events ?? []).map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("en-PK")}</span> · {e.from_status ?? "—"} → <strong>{e.to_status}</strong>
              {e.note ? ` · ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
