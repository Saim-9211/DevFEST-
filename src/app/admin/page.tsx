import Link from "next/link";
import type { Metadata } from "next";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toCycle } from "@/lib/data";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Stat } from "@/components/ui/primitives";
import { verifySupplier } from "./actions";
import { CycleActions } from "./cycle-actions";
import { KpiGrid, type Kpis } from "./kpis";

export const metadata: Metadata = { title: "Operations" };

const status = dictionaries.en.cycleStatus;

/** Admin control room (English-only staff screen). */
export default async function AdminHome() {
  await requireArea("admin");
  const supabase = await createClient();

  const [buildings, households, suppliers, { data: pendingSuppliers }, { data: cycleRows }] = await Promise.all([
    supabase.from("buildings").select("*", { count: "exact", head: true }),
    supabase.from("building_members").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("suppliers").select("*", { count: "exact", head: true }).eq("verified", true),
    supabase.from("suppliers").select("id, business_name, city, ntn, strn, contact_phone").eq("verified", false),
    supabase.from("buying_cycles").select("*, cluster:clusters(name)").order("open_at", { ascending: false }).limit(8),
  ]);
  const cycles = (cycleRows ?? []).map((c) => ({ ...toCycle(c), cluster: (c as { cluster: { name: string } | null }).cluster }));
  const live = cycles.find((c) => c.status !== "draft" && c.status !== "cancelled");
  const { data: kpis } = live ? await supabase.rpc("admin_cycle_kpis", { p_cycle: live.id }) : { data: null };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Control room</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Buildings" value={buildings.count ?? 0} />
        <Stat label="Approved households" value={households.count ?? 0} />
        <Stat label="Verified suppliers" value={suppliers.count ?? 0} />
      </div>

      {live && kpis ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            {live.name} · <Badge tone="brand">{status[live.status]}</Badge>
          </h2>
          <KpiGrid k={kpis as Kpis} />
        </section>
      ) : null}

      <Card className="space-y-3">
        <CardTitle>Buying cycles</CardTitle>
        <ul className="divide-y divide-border">
          {cycles.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link href={`/admin/cycles/${c.id}`} className="font-medium text-brand underline">
                  {c.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {c.cluster?.name} · cutoff {new Date(c.cutoff_at).toLocaleString("en-PK")} · delivery {c.delivery_date} · deposit {c.deposit_pct}% ·
                  min {c.min_households} households / Rs {c.min_order_value.toLocaleString("en-PK")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={c.status === "cancelled" ? "danger" : "brand"}>{status[c.status]}</Badge>
                <CycleActions cycleId={c.id} status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <CardTitle>Suppliers awaiting verification</CardTitle>
        {(pendingSuppliers ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing pending.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(pendingSuppliers ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{s.business_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {s.city} · NTN {s.ntn ?? "—"} · STRN {s.strn ?? "—"} · {s.contact_phone}
                  </p>
                </div>
                <form action={verifySupplier.bind(null, s.id)}>
                  <Button size="sm">Verify</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
