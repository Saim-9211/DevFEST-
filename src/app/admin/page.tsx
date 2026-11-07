import type { Metadata } from "next";
import { requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Stat } from "@/components/ui/primitives";
import { advanceCycle, verifySupplier } from "./actions";

export const metadata: Metadata = { title: "Operations" };

type CycleStatus = keyof Dictionary["cycleStatus"];

export default async function AdminHome() {
  await requireArea("admin");
  const { t } = await getDictionary();
  const a = t.admin;
  const supabase = await createClient();

  const [buildings, households, suppliers, products, { data: pendingSuppliers }, { data: cycles }, { data: transitions }] =
    await Promise.all([
      supabase.from("buildings").select("*", { count: "exact", head: true }),
      supabase.from("building_members").select("*", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("suppliers").select("*", { count: "exact", head: true }).eq("verified", true),
      supabase.from("products").select("*", { count: "exact", head: true }).eq("active", true),
      supabase.from("suppliers").select("id, business_name, city, ntn, strn, contact_phone").eq("verified", false),
      supabase
        .from("buying_cycles")
        .select("id, name, status, cutoff_at, delivery_date, cluster:clusters(name)")
        .order("open_at", { ascending: false })
        .limit(10),
      supabase.from("cycle_transitions").select("from_status, to_status"),
    ]);

  const nextStates = (from: CycleStatus) =>
    (transitions ?? []).filter((tr) => tr.from_status === from).map((tr) => tr.to_status as CycleStatus);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{a.title}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={a.buildings} value={buildings.count ?? 0} />
        <Stat label={a.households} value={households.count ?? 0} />
        <Stat label={a.suppliers} value={suppliers.count ?? 0} />
        <Stat label={a.products} value={products.count ?? 0} />
      </div>

      <Card className="space-y-3">
        <CardTitle>{a.cycles}</CardTitle>
        <ul className="divide-y divide-border">
          {((cycles ?? []) as unknown as {
            id: string;
            name: string;
            status: CycleStatus;
            delivery_date: string;
            cluster: { name: string } | null;
          }[]).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {c.cluster?.name} · {t.resident.deliveryOn} {c.delivery_date}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={c.status === "cancelled" ? "danger" : "brand"}>{t.cycleStatus[c.status]}</Badge>
                {nextStates(c.status).map((to) => (
                  <form key={to} action={advanceCycle.bind(null, c.id, to)}>
                    <Button size="sm" variant={to === "cancelled" ? "ghost" : "secondary"}>
                      {a.advanceTo}: {t.cycleStatus[to]}
                    </Button>
                  </form>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <CardTitle>{a.pendingSuppliers}</CardTitle>
        {(pendingSuppliers ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{a.none}</p>
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
                  <Button size="sm">{a.verify}</Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
