import Link from "next/link";
import type { Metadata } from "next";
import { Bell, Clock, Wallet, XCircle } from "lucide-react";
import { activeMembership, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { getBuildingProgress, getCreditBalance, getCurrentCycle, getMyBasket } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/utils";
import { CycleCard } from "@/components/cycle-card";
import { BuildingProgress } from "@/components/building-progress";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardTitle, Notice } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My household" };

export default async function ResidentHome() {
  const ctx = await requireArea("resident");
  const { t, locale } = await getDictionary();
  const r = t.resident;
  const m = activeMembership(ctx)!;

  if (m.status !== "approved") {
    const rejected = m.status === "rejected";
    return (
      <Card className="flex items-start gap-3">
        {rejected ? <XCircle className="mt-0.5 size-5 text-danger" aria-hidden /> : <Clock className="mt-0.5 size-5 text-accent" aria-hidden />}
        <div className="space-y-2">
          <h1 className="font-semibold">{rejected ? r.rejectedTitle : r.pendingTitle}</h1>
          <p className="text-sm text-muted-foreground">{rejected ? r.rejectedBody : r.pendingBody}</p>
          <p className="text-sm">
            {m.building.name} · {r.flat} {m.flat_no}
          </p>
          {rejected ? (
            <Link href="/onboarding" className={buttonClass("secondary", "sm")}>
              {t.onboarding.joinWithCode}
            </Link>
          ) : null}
        </div>
      </Card>
    );
  }

  const cycle = await getCurrentCycle(m.building.cluster_id);
  const supabase = await createClient();
  const [basket, progress, credit, { data: notes }] = await Promise.all([
    cycle ? getMyBasket(cycle.id, ctx.userId) : null,
    cycle ? getBuildingProgress(cycle.id, m.building_id) : null,
    getCreditBalance(),
    supabase.from("notifications").select("id, title, body, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{ctx.profile.full_name}</h1>
        <p className="text-muted-foreground">
          {m.building.name} · {r.flat} {m.flat_no}
        </p>
      </div>

      {ctx.profile.upfront_only ? <Notice tone="error">{r.upfrontNotice}</Notice> : null}

      {cycle ? <CycleCard cycle={cycle} t={t} locale={locale} /> : <Notice>{r.noCycle}</Notice>}
      {cycle && progress && ["open", "locked"].includes(cycle.status) ? <BuildingProgress p={progress} t={t} locale={locale} /> : null}

      {cycle ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          {basket && basket.status !== "draft" ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <Badge tone={basket.status === "cancelled" || basket.status === "no_show" ? "danger" : "brand"}>{t.basketStatus[basket.status]}</Badge>
                <Badge>{t.paymentStatus[basket.payment_status]}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t.basket.total}: <strong className="text-foreground">{formatPKR(basket.total, locale)}</strong> · {t.basket.balance}:{" "}
                {formatPKR(basket.balance_due, locale)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{basket ? `${t.basket.total}: ${formatPKR(basket.total, locale)}` : t.basket.empty}</p>
          )}
          {cycle.status === "open" && (!basket || basket.status === "draft") ? (
            <Link href="/resident/catalog" className={buttonClass("primary")}>
              {basket ? r.editBasket : r.startOrder}
            </Link>
          ) : (
            <Link href="/resident/order" className={buttonClass("secondary")}>
              {r.viewOrder}
            </Link>
          )}
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Wallet className="size-4" aria-hidden />
            {r.credit}
          </p>
          <p className="mt-1 text-2xl font-semibold">{formatPKR(credit, locale)}</p>
        </Card>
        <Card className="space-y-2 sm:col-span-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Bell className="size-4" aria-hidden />
            {r.notifications}
          </CardTitle>
          {(notes ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{r.noNotifications}</p>
          ) : (
            <ul className="space-y-2">
              {(notes ?? []).map((n) => (
                <li key={n.id} className="text-sm">
                  <p className="font-medium">{n.title}</p>
                  {n.body ? <p className="text-muted-foreground">{n.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
