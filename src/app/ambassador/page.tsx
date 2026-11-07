import type { Metadata } from "next";
import { Check, KeyRound, PackageCheck, X } from "lucide-react";
import { ambassadorMembership, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { getBuildingProgress, getCurrentCycle, toBasket, type Basket } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/utils";
import { BuildingProgress } from "@/components/building-progress";
import { CycleCard } from "@/components/cycle-card";
import { HandoverForm } from "@/components/handover-form";
import { LiveRefresh } from "@/components/live-refresh";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, Notice } from "@/components/ui/primitives";
import { checkInDelivery, handOver, reviewMember } from "./actions";

export const metadata: Metadata = { title: "Building Ambassador" };

type MemberRow = {
  id: string;
  user_id: string;
  flat_no: string;
  status: "pending" | "approved";
  member_role: "resident" | "ambassador";
  profile: { full_name: string; phone: string | null } | null;
};

export default async function AmbassadorHome() {
  const ctx = await requireArea("ambassador");
  const { t, locale } = await getDictionary();
  const a = t.ambassador;
  const building = ambassadorMembership(ctx)!.building;
  const cycle = await getCurrentCycle(building.cluster_id);
  const supabase = await createClient();

  const [{ data: invite }, { data: memberRows }, { data: basketRows }, { data: deliveries }, { data: claims }, progress] = await Promise.all([
    supabase.rpc("get_building_invite", { p_building: building.id }),
    supabase
      .from("building_members")
      .select("id, user_id, flat_no, status, member_role, profile:profiles!building_members_user_id_fkey(full_name, phone)")
      .eq("building_id", building.id)
      .in("status", ["pending", "approved"])
      .order("flat_no"),
    cycle
      ? supabase.from("baskets").select("*").eq("cycle_id", cycle.id).eq("building_id", building.id)
      : Promise.resolve({ data: [] }),
    cycle
      ? supabase
          .from("deliveries")
          .select("id, delivered_at, po:purchase_orders!inner(cycle_id, status, supplier:suppliers(business_name))")
          .eq("building_id", building.id)
          .eq("po.cycle_id", cycle.id)
      : Promise.resolve({ data: [] }),
    supabase.from("disputes").select("id, type, qty, claim_amount, status, photo_path").eq("route", "batch_return"),
    cycle ? getBuildingProgress(cycle.id, building.id) : null,
  ]);

  const members = (memberRows ?? []) as unknown as MemberRow[];
  const pending = members.filter((m) => m.status === "pending");
  const flatOf = new Map(members.map((m) => [m.user_id, m]));
  const baskets = ((basketRows ?? []) as Record<string, unknown>[]).map(toBasket).filter((b) => b.status !== "draft");
  const ready = baskets.filter((b) => b.status === "ready");
  const flat = (b: Basket) => flatOf.get(b.user_id);

  return (
    <div className="space-y-6">
      <LiveRefresh channel={`building-${building.id}`} tables={["baskets", "building_members"]} filter={`building_id=eq.${building.id}`} />
      <div>
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="text-muted-foreground">{building.name}</p>
      </div>

      {cycle ? <CycleCard cycle={cycle} t={t} locale={locale} /> : null}
      {cycle && progress && ["open", "locked"].includes(cycle.status) ? <BuildingProgress p={progress} t={t} locale={locale} /> : null}

      {/* Pickup desk */}
      {cycle?.status === "distributing" ? (
        <Card className="space-y-3 border-brand/40">
          <CardTitle>
            {a.pickupDesk} · {ready.length}
          </CardTitle>
          <Notice>{a.noCash}</Notice>
          <ul className="divide-y divide-border">
            {ready.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {flat(b)?.flat_no} · {flat(b)?.profile?.full_name}
                  </p>
                  {b.payment_status === "paid_in_full" ? (
                    <Badge tone="brand">{t.paymentStatus.paid_in_full}</Badge>
                  ) : (
                    <Badge tone="warn">
                      {a.balanceDue}: {formatPKR(b.balance_due, locale)}
                    </Badge>
                  )}
                </div>
                {b.payment_status === "paid_in_full" ? (
                  <HandoverForm action={handOver.bind(null, b.id)} label={a.enterCode} button={a.handOver} />
                ) : null}
              </li>
            ))}
            {ready.length === 0 ? <li className="py-3 text-sm text-muted-foreground">—</li> : null}
          </ul>
        </Card>
      ) : null}

      {/* Supplier drop-offs */}
      {(deliveries ?? []).length > 0 ? (
        <Card className="space-y-3">
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="size-5 text-brand" aria-hidden />
            {a.deliveries}
          </CardTitle>
          <ul className="divide-y divide-border">
            {((deliveries ?? []) as unknown as { id: string; delivered_at: string | null; po: { status: string; supplier: { business_name: string } } }[]).map(
              (d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{d.po.supplier.business_name}</p>
                    <p className="text-sm text-muted-foreground">PO: {d.po.status}</p>
                  </div>
                  {d.delivered_at ? (
                    <Badge tone="brand">{a.received}</Badge>
                  ) : d.po.status === "dispatched" ? (
                    <form action={checkInDelivery.bind(null, d.id)}>
                      <Button size="sm">{a.checkIn}</Button>
                    </form>
                  ) : (
                    <Badge>{d.po.status}</Badge>
                  )}
                </li>
              ),
            )}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <KeyRound className="size-4" aria-hidden />
            {a.inviteCode}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-widest">{invite ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{a.shareHint}</p>
        </Card>
        <Card className="sm:col-span-2 space-y-3">
          <CardTitle>{a.pending}</CardTitle>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{a.noPending}</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <p className="text-sm">
                    <strong>{m.flat_no}</strong> · {m.profile?.full_name || "—"} {m.profile?.phone ? `· ${m.profile.phone}` : ""}
                  </p>
                  <div className="flex gap-2">
                    <form action={reviewMember.bind(null, m.id, true)}>
                      <Button size="sm">
                        <Check className="size-4" aria-hidden />
                        {a.approve}
                      </Button>
                    </form>
                    <form action={reviewMember.bind(null, m.id, false)}>
                      <Button size="sm" variant="secondary">
                        <X className="size-4" aria-hidden />
                        {a.reject}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <CardTitle>
          {a.orders} · {baskets.length}
        </CardTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {baskets.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <span>
                <strong>{flat(b)?.flat_no}</strong> · {flat(b)?.profile?.full_name}
              </span>
              <span className="flex items-center gap-2">
                {formatPKR(b.total, locale)}
                <Badge tone={b.status === "cancelled" || b.status === "no_show" ? "danger" : b.status === "pending_deposit" ? "warn" : "brand"}>
                  {t.basketStatus[b.status]}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {(claims ?? []).length > 0 ? (
        <Card className="space-y-2">
          <CardTitle>{a.returns}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {(claims ?? []).map((c) => (
              <li key={c.id} className="flex justify-between py-2">
                <span>
                  {c.type} × {c.qty}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={c.status === "open" ? "warn" : "neutral"}>{c.status}</Badge>
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
