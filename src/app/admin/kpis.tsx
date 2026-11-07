import { formatPKR } from "@/lib/utils";
import { Stat } from "@/components/ui/primitives";

export type Kpis = Record<string, number>;

/** Cycle KPIs from the `admin_cycle_kpis` RPC. */
export function KpiGrid({ k }: { k: Kpis }) {
  const n = (key: string) => Number(k[key] ?? 0);
  const savingsPct = n("retail_value") > 0 ? (1 - n("gmv") / n("retail_value")) * 100 : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="GMV (households)" value={`${formatPKR(n("gmv"))} (${n("households")})`} />
      <Stat label="Avg basket savings vs retail" value={`${savingsPct.toFixed(1)}%`} />
      <Stat label="Platform margin (on units sold)" value={`${formatPKR(n("margin"))} · ${n("margin_pct")}%`} />
      <Stat label="Surplus stock (bulk rounding)" value={formatPKR(n("surplus_stock_value"))} />
      <Stat label="Deposits collected" value={formatPKR(n("deposits_collected"))} />
      <Stat label="Balances collected" value={formatPKR(n("balances_collected"))} />
      <Stat label="Refunded · forfeited" value={`${formatPKR(n("refunded"))} · ${formatPKR(n("forfeited"))}`} />
      <Stat label="Collected · no-shows · cash with agents" value={`${n("collected")} · ${n("no_shows")} · ${formatPKR(n("cash_with_agents"))}`} />
    </div>
  );
}
