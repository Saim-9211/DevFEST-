import { CalendarClock, Truck } from "lucide-react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { Badge, Card } from "@/components/ui/primitives";

export type CycleSummary = {
  id: string;
  name: string;
  status: keyof Dictionary["cycleStatus"];
  cutoff_at: string;
  delivery_date: string;
};

function timeLeft(iso: string, t: Dictionary) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days} ${t.common.days} ${hours % 24} ${t.common.hours}` : `${hours} ${t.common.hours}`;
}

export function CycleCard({ cycle, t, locale }: { cycle: CycleSummary; t: Dictionary; locale: "en" | "ur" }) {
  const left = cycle.status === "open" ? timeLeft(cycle.cutoff_at, t) : null;
  const delivery = new Date(`${cycle.delivery_date}T00:00:00`).toLocaleDateString(locale === "ur" ? "ur-PK" : "en-PK", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{t.resident.currentCycle}</p>
          <h2 className="text-lg font-semibold">{cycle.name}</h2>
        </div>
        <Badge tone={cycle.status === "open" ? "brand" : "neutral"}>{t.cycleStatus[cycle.status]}</Badge>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {left ? (
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-accent" aria-hidden />
            {t.resident.cutoffIn}: <strong>{left}</strong>
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <Truck className="size-4 text-brand" aria-hidden />
          {t.resident.deliveryOn}: <strong>{delivery}</strong>
        </span>
      </div>
    </Card>
  );
}
