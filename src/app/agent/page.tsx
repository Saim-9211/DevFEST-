import type { Metadata } from "next";
import { Banknote } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toBasket } from "@/lib/data";
import { formatPKR } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/form";
import { HandoverForm } from "@/components/handover-form";
import { Badge, Card, CardTitle, Notice, Stat } from "@/components/ui/primitives";
import { handOver } from "@/app/ambassador/actions";
import { collectCash } from "./actions";

export const metadata: Metadata = { title: "Agent" };

type Member = { user_id: string; flat_no: string; building_id: string; profile: { full_name: string; phone: string | null } | null };

/** Field agent console (English-only staff screen). */
export default async function AgentHome() {
  const ctx = await requireArea("agent");
  const supabase = await createClient();

  const [{ data: assigned }, { data: basketRows }, { data: members }, { data: cash }] = await Promise.all([
    supabase.from("agent_buildings").select("building:buildings(id, name, address)").eq("agent_id", ctx.userId),
    supabase.from("baskets").select("*").in("status", ["ready", "collected"]),
    supabase
      .from("building_members")
      .select("user_id, flat_no, building_id, profile:profiles!building_members_user_id_fkey(full_name, phone)")
      .eq("status", "approved"),
    supabase
      .from("payments")
      .select("id, amount, receipt_no, verified_at, deposited_at")
      .eq("collected_by", ctx.userId)
      .eq("method", "cash_agent")
      .order("verified_at", { ascending: false }),
  ]);

  const buildings = ((assigned ?? []) as unknown as { building: { id: string; name: string; address: string } }[]).map((a) => a.building);
  const baskets = ((basketRows ?? []) as Record<string, unknown>[]).map(toBasket);
  const who = new Map(((members ?? []) as unknown as Member[]).map((m) => [m.user_id, m]));
  const cashOnHand = (cash ?? []).filter((c) => !c.deposited_at).reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agent console</h1>
        <p className="text-muted-foreground">{ctx.profile.full_name} · authorized cash collection</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Cash on hand (not yet deposited)" value={formatPKR(cashOnHand)} />
        <Stat label="Receipts issued" value={(cash ?? []).length} />
        <Stat label="Assigned buildings" value={buildings.length} />
      </div>

      <Notice>Record every cash payment the moment you receive it. The resident gets an in-app receipt immediately.</Notice>

      {buildings.map((b) => {
        const list = baskets.filter((k) => k.building_id === b.id);
        const ready = list.filter((k) => k.status === "ready");
        return (
          <Card key={b.id} className="space-y-3">
            <CardTitle>
              {b.name} <span className="text-sm font-normal text-muted-foreground">· {b.address}</span>
            </CardTitle>
            {ready.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders waiting for pickup.</p>
            ) : (
              <ul className="divide-y divide-border">
                {ready.map((k) => {
                  const m = who.get(k.user_id);
                  return (
                    <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">
                          {m?.flat_no} · {m?.profile?.full_name} {m?.profile?.phone ? `· ${m.profile.phone}` : ""}
                        </p>
                        {k.payment_status === "paid_in_full" ? (
                          <Badge tone="brand">Paid in full</Badge>
                        ) : (
                          <Badge tone="warn">Balance due {formatPKR(k.balance_due)}</Badge>
                        )}
                      </div>
                      {k.payment_status === "paid_in_full" ? (
                        <HandoverForm action={handOver.bind(null, k.id)} label="Pickup code" button="Hand over" />
                      ) : (
                        <ActionForm action={collectCash.bind(null, k.id)} className="flex flex-col items-end gap-2">
                          <SubmitButton>
                            <Banknote className="size-4" aria-hidden />
                            Collect cash {formatPKR(k.balance_due)}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Collected: {list.filter((k) => k.status === "collected").length} · Waiting: {ready.length}
            </p>
          </Card>
        );
      })}

      <Card className="space-y-2">
        <CardTitle>My cash receipts</CardTitle>
        <ul className="divide-y divide-border text-sm">
          {(cash ?? []).map((c) => (
            <li key={c.id} className="flex justify-between py-2">
              <span className="font-mono">{c.receipt_no}</span>
              <span className="flex items-center gap-2">
                {c.deposited_at ? <Badge tone="brand">Deposited</Badge> : <Badge tone="warn">On hand</Badge>}
                {formatPKR(Number(c.amount))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
