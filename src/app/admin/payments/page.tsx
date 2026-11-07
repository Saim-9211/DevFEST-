import type { Metadata } from "next";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/primitives";
import { markCashDeposited } from "../actions";

export const metadata: Metadata = { title: "Payments & cash" };

type Payment = {
  id: string;
  kind: string;
  method: string;
  amount: number;
  state: string;
  provider_ref: string | null;
  receipt_no: string | null;
  collected_by: string | null;
  deposited_at: string | null;
  created_at: string;
};

export default async function AdminPayments() {
  await requireArea("admin");
  const supabase = await createClient();
  const [{ data: payments }, { data: agents }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, kind, method, amount, state, provider_ref, receipt_no, collected_by, deposited_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id, full_name, phone").eq("role", "agent"),
  ]);
  const rows = ((payments ?? []) as Payment[]).map((p) => ({ ...p, amount: Number(p.amount) }));
  const sum = (f: (p: Payment) => boolean) => rows.filter(f).reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payments & cash reconciliation</h1>

      <Card className="space-y-3">
        <CardTitle>Agent cash</CardTitle>
        <p className="text-sm text-muted-foreground">
          Only authorized agents collect cash, and each receipt is recorded the moment it is taken. Mark an agent&apos;s cash as deposited once the
          bank deposit slip matches.
        </p>
        <ul className="divide-y divide-border">
          {(agents ?? []).map((a) => {
            const onHand = sum((p) => p.collected_by === a.id && p.method === "cash_agent" && p.state === "verified" && !p.deposited_at);
            const total = sum((p) => p.collected_by === a.id && p.method === "cash_agent" && p.state === "verified");
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{a.full_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.phone} · collected {formatPKR(total)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={onHand > 0 ? "warn" : "brand"}>On hand {formatPKR(onHand)}</Badge>
                  {onHand > 0 ? (
                    <form action={markCashDeposited.bind(null, a.id)}>
                      <Button size="sm">Mark deposited</Button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-2 overflow-x-auto">
        <CardTitle>Recent payments</CardTitle>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="p-2 text-start font-medium">When</th>
              <th className="p-2 text-start font-medium">Kind</th>
              <th className="p-2 text-start font-medium">Method</th>
              <th className="p-2 text-start font-medium">Reference</th>
              <th className="p-2 text-start font-medium">State</th>
              <th className="p-2 text-end font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="p-2 text-muted-foreground">{new Date(p.created_at).toLocaleString("en-PK")}</td>
                <td className="p-2">{p.kind}</td>
                <td className="p-2">{p.method}</td>
                <td className="p-2 font-mono text-xs">{p.receipt_no ?? p.provider_ref ?? "—"}</td>
                <td className="p-2">
                  <Badge tone={p.state === "verified" ? "brand" : p.state === "failed" ? "danger" : "neutral"}>{p.state}</Badge>
                </td>
                <td className="p-2 text-end">
                  {p.kind === "refund" ? "−" : ""}
                  {formatPKR(p.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
