import Link from "next/link";
import type { Metadata } from "next";
import { Clock, ShieldCheck, XCircle } from "lucide-react";
import { activeMembership, isCaptain, requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { CycleCard, type CycleSummary } from "@/components/cycle-card";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, Notice } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My household" };

export default async function ResidentHome() {
  const ctx = await requireArea("resident");
  const { t, locale } = await getDictionary();
  const membership = activeMembership(ctx)!;
  const r = t.resident;

  let cycle: CycleSummary | null = null;
  if (membership.status === "approved" && membership.building.cluster_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("buying_cycles")
      .select("id, name, status, cutoff_at, delivery_date")
      .eq("cluster_id", membership.building.cluster_id)
      .not("status", "in", "(draft,closed,cancelled)")
      .order("open_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    cycle = data as CycleSummary | null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {r.title}: {ctx.profile.full_name}
          </h1>
          <p className="text-muted-foreground">
            {membership.building.name} · {r.flat} {membership.flat_no}
          </p>
        </div>
        {isCaptain(ctx) ? (
          <Link href="/captain" className={buttonClass("secondary")}>
            <ShieldCheck className="size-4" aria-hidden />
            {r.captainArea}
          </Link>
        ) : null}
      </div>

      {membership.status === "pending" ? (
        <Card className="flex items-start gap-3">
          <Clock className="mt-0.5 size-5 text-accent" aria-hidden />
          <div>
            <h2 className="font-semibold">{r.pendingTitle}</h2>
            <p className="text-sm text-muted-foreground">{r.pendingBody}</p>
          </div>
        </Card>
      ) : null}

      {membership.status === "rejected" ? (
        <Card className="flex items-start gap-3">
          <XCircle className="mt-0.5 size-5 text-danger" aria-hidden />
          <div className="space-y-2">
            <h2 className="font-semibold">{r.rejectedTitle}</h2>
            <p className="text-sm text-muted-foreground">{r.rejectedBody}</p>
            <Link href="/onboarding" className={buttonClass("secondary", "sm")}>
              {t.onboarding.joinWithCode}
            </Link>
          </div>
        </Card>
      ) : null}

      {membership.status === "approved" ? (
        <>
          {cycle ? <CycleCard cycle={cycle} t={t} locale={locale} /> : <Notice>{r.noCycle}</Notice>}
          <Card className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{r.basketSoon}</span>
            <Badge tone="warn">Phase 2</Badge>
          </Card>
        </>
      ) : null}
    </div>
  );
}
