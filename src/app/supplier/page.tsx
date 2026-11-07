import type { Metadata } from "next";
import { BadgeCheck, Hourglass } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Input, Notice } from "@/components/ui/primitives";
import { saveQuote, updatePo } from "./actions";

export const metadata: Metadata = { title: "Supplier portal" };

type Product = { id: string; name_en: string; brand: string | null; bulk_unit_label: string; split_factor: number };
type Quote = { product_id: string; price_per_bulk: number; min_bulk_units: number; max_bulk_units: number | null };
type Po = {
  id: string;
  status: "pending" | "accepted" | "dispatched" | "delivered" | "cancelled";
  subtotal: number;
  cycle: { name: string; delivery_date: string };
  lines: { bulk_qty: number; unit_price_bulk: number; lot: { product: { name_en: string; bulk_unit_label: string } } }[];
  deliveries: { delivered_at: string | null; building: { name: string; address: string } }[];
};

/** Supplier portal (English-only staff screen). */
export default async function SupplierHome() {
  const ctx = await requireArea("supplier");
  const supplier = ctx.supplier!;
  const supabase = await createClient();

  const [{ data: cycles }, { data: products }, { data: quotes }, { data: pos }] = await Promise.all([
    supabase.from("buying_cycles").select("id, name, status, cutoff_at").in("status", ["draft", "open"]).order("open_at", { ascending: false }),
    supabase.from("products").select("id, name_en, brand, bulk_unit_label, split_factor").eq("active", true).order("name_en"),
    supabase.from("supplier_quotes").select("cycle_id, product_id, price_per_bulk, min_bulk_units, max_bulk_units").eq("supplier_id", supplier.id),
    supabase
      .from("purchase_orders")
      .select(
        "id, status, subtotal, cycle:buying_cycles(name, delivery_date), lines:po_lines(bulk_qty, unit_price_bulk, lot:demand_lots(product:products(name_en, bulk_unit_label))), deliveries(delivered_at, building:buildings(name, address))",
      )
      .eq("supplier_id", supplier.id)
      .order("created_at", { ascending: false }),
  ]);

  const quoteKey = (c: string, p: string) => `${c}:${p}`;
  const quoteMap = new Map(((quotes ?? []) as (Quote & { cycle_id: string })[]).map((q) => [quoteKey(q.cycle_id, q.product_id), q]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Supplier portal</h1>
          <p className="text-muted-foreground">
            {supplier.business_name} · {supplier.city}
          </p>
        </div>
        {supplier.verified ? (
          <Badge tone="brand">
            <BadgeCheck className="me-1 size-3.5" aria-hidden /> Verified
          </Badge>
        ) : (
          <Badge tone="warn">
            <Hourglass className="me-1 size-3.5" aria-hidden /> Verification pending
          </Badge>
        )}
      </div>

      {!supplier.verified ? (
        <Notice>Our team is checking your NTN/STRN and business documents. You can submit rate cards once verified.</Notice>
      ) : null}

      {/* Purchase orders */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Purchase orders</h2>
        {((pos ?? []) as unknown as Po[]).length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase orders yet. They are issued after each cycle&apos;s cutoff, only for deposit-backed demand.</p>
        ) : (
          ((pos ?? []) as unknown as Po[]).map((po) => (
            <Card key={po.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {po.cycle.name} · {formatPKR(Number(po.subtotal))}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge tone={po.status === "dispatched" ? "brand" : "warn"}>{po.status}</Badge>
                  {po.status === "pending" ? (
                    <form action={updatePo.bind(null, po.id, "accepted")}>
                      <Button size="sm">Accept PO</Button>
                    </form>
                  ) : po.status === "accepted" ? (
                    <form action={updatePo.bind(null, po.id, "dispatched")}>
                      <Button size="sm">Mark dispatched</Button>
                    </form>
                  ) : null}
                </div>
              </div>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {po.lines.map((l, i) => (
                  <li key={i} className="flex justify-between rounded bg-muted px-3 py-1.5">
                    <span>
                      {l.lot.product.name_en} · {l.bulk_qty} × {l.lot.product.bulk_unit_label}
                    </span>
                    <span>{formatPKR(l.bulk_qty * Number(l.unit_price_bulk))}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                Drop-offs ({po.cycle.delivery_date}):{" "}
                {po.deliveries.map((d) => `${d.building.name}${d.delivered_at ? " ✓" : ""}`).join(" · ")}
              </p>
            </Card>
          ))
        )}
      </section>

      {/* Rate cards */}
      {supplier.verified
        ? (cycles ?? []).map((c) => (
            <section key={c.id} className="space-y-3">
              <h2 className="text-lg font-semibold">
                Rate card · {c.name} <span className="text-sm font-normal text-muted-foreground">(editable until cutoff)</span>
              </h2>
              <p className="text-sm text-muted-foreground">
                Price per bulk unit. At cutoff the cheapest verified rate card that covers the volume wins each product.
              </p>
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start font-medium">Product</th>
                      <th className="p-3 text-start font-medium">Bulk unit</th>
                      <th className="p-3 text-start font-medium">Price / bulk · min · max units</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {((products ?? []) as Product[]).map((p) => {
                      const q = quoteMap.get(quoteKey(c.id, p.id));
                      return (
                        <tr key={p.id}>
                          <td className="p-3">
                            {p.name_en}
                            {p.brand ? <span className="text-muted-foreground"> · {p.brand}</span> : null}
                          </td>
                          <td className="p-3 text-muted-foreground">{p.bulk_unit_label}</td>
                          <td className="p-3">
                            <form action={saveQuote.bind(null, c.id, p.id)} className="flex flex-wrap items-center gap-1.5">
                              <Input name="price_per_bulk" type="number" step="0.01" min="0.01" defaultValue={q?.price_per_bulk ?? ""} className="h-8 w-28" aria-label="Price per bulk unit" required />
                              <Input name="min_bulk_units" type="number" min={1} defaultValue={q?.min_bulk_units ?? 1} className="h-8 w-16" aria-label="Minimum bulk units" />
                              <Input name="max_bulk_units" type="number" min={1} defaultValue={q?.max_bulk_units ?? ""} placeholder="∞" className="h-8 w-16" aria-label="Maximum bulk units" />
                              <Button size="sm" variant={q ? "secondary" : "primary"}>
                                {q ? "Update" : "Quote"}
                              </Button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </section>
          ))
        : null}
    </div>
  );
}
