import { Users } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Progress } from "@/lib/data";
import { meetsMinimum } from "@/lib/pricing";
import { formatPKR } from "@/lib/utils";
import { ProgressBar } from "@/components/progress";
import { Card } from "@/components/ui/primitives";

/** Building's progress toward this cycle's minimum (households + order value). */
export function BuildingProgress({ p, t, locale }: { p: Progress; t: Dictionary; locale: "en" | "ur" }) {
  const m = meetsMinimum(p.households, p.order_value, p);
  const short = t.resident.progressShort
    .replace("{households}", String(m.householdsShort))
    .replace("{value}", new Intl.NumberFormat("en-PK").format(Math.round(m.valueShort)));

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Users className="size-4 text-brand" aria-hidden />
          {t.resident.buildingProgress}
        </p>
        <p className="text-sm text-muted-foreground">
          {p.households}/{p.min_households} {t.resident.households} · {formatPKR(p.order_value, locale)} / {formatPKR(p.min_order_value, locale)}
        </p>
      </div>
      <ProgressBar value={m.progress} tone={m.met ? "brand" : "warn"} label={t.resident.buildingProgress} />
      <p className={m.met ? "text-sm text-brand" : "text-sm text-muted-foreground"}>{m.met ? t.resident.progressMet : short}</p>
    </Card>
  );
}
