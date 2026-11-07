import type { Metadata } from "next";
import { Check, KeyRound, X } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Stat } from "@/components/ui/primitives";
import { reviewMember } from "./actions";

export const metadata: Metadata = { title: "Building Captain" };

type MemberRow = {
  id: string;
  flat_no: string;
  status: "pending" | "approved" | "rejected";
  member_role: "resident" | "captain";
  created_at: string;
  profile: { full_name: string; phone: string | null } | null;
};

export default async function CaptainHome() {
  const ctx = await requireArea("captain");
  const { t } = await getDictionary();
  const c = t.captain;
  const membership = ctx.memberships.find((m) => m.member_role === "captain" && m.status === "approved")!;
  const building = membership.building;

  const supabase = await createClient();
  const [{ data: invite }, { data: rows }] = await Promise.all([
    supabase.rpc("get_building_invite", { p_building: building.id }),
    supabase
      .from("building_members")
      .select("id, flat_no, status, member_role, created_at, profile:profiles!building_members_user_id_fkey(full_name, phone)")
      .eq("building_id", building.id)
      .in("status", ["pending", "approved"])
      .order("flat_no"),
  ]);
  const members = (rows ?? []) as unknown as MemberRow[];
  const pending = members.filter((m) => m.status === "pending");
  const approved = members.filter((m) => m.status === "approved");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-muted-foreground">{building.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-1">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <KeyRound className="size-4" aria-hidden />
            {c.inviteCode}
          </p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-widest">{invite ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{c.shareHint}</p>
        </Card>
        <Stat label={c.members} value={`${approved.length} / ${building.total_flats || "?"}`} />
        <Stat label={c.pending} value={pending.length} />
      </div>

      <Card className="space-y-3">
        <CardTitle>{c.pending}</CardTitle>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noPending}</p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {m.profile?.full_name || "—"} · {t.resident.flat} {m.flat_no}
                  </p>
                  {m.profile?.phone ? <p className="text-sm text-muted-foreground">{m.profile.phone}</p> : null}
                </div>
                <div className="flex gap-2">
                  <form action={reviewMember.bind(null, m.id, true)}>
                    <Button size="sm">
                      <Check className="size-4" aria-hidden />
                      {c.approve}
                    </Button>
                  </form>
                  <form action={reviewMember.bind(null, m.id, false)}>
                    <Button size="sm" variant="secondary">
                      <X className="size-4" aria-hidden />
                      {c.reject}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <CardTitle>{c.members}</CardTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {approved.map((m) => (
            <li key={m.id} className="rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{m.flat_no}</span> · {m.profile?.full_name || "—"}
              {m.member_role === "captain" ? " ★" : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
