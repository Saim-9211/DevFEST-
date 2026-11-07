import { cn } from "@/lib/utils";

export function ProgressBar({ value, tone = "brand", label }: { value: number; tone?: "brand" | "warn"; label?: string }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full rounded-full transition-all", tone === "brand" ? "bg-brand" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}
