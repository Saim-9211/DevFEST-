import { METHOD_INFO, ONLINE_METHODS } from "@/lib/payments/gateway";

/** Radio list of online payment methods (inside an ActionForm). */
export function PayMethods({ locale }: { locale: "en" | "ur" }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-3">
      {ONLINE_METHODS.map((m, i) => (
        <label
          key={m}
          className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
        >
          <input type="radio" name="method" value={m} defaultChecked={i === 0} className="mt-1 accent-[var(--brand)]" />
          <span>
            <span className="block font-medium">{locale === "ur" ? METHOD_INFO[m].labelUr : METHOD_INFO[m].label}</span>
            <span className="block text-xs text-muted-foreground">{METHOD_INFO[m].hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
