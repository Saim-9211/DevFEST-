import type { Metadata } from "next";
import { BadgeCheck, Hourglass } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { Badge, Card } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Supplier portal" };

export default async function SupplierHome() {
  const ctx = await requireArea("supplier");
  const { t } = await getDictionary();
  const s = t.supplier;
  const supplier = ctx.supplier!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-muted-foreground">
          {supplier.business_name} · {supplier.city}
        </p>
      </div>

      {supplier.verified ? (
        <Card className="flex items-start gap-3">
          <BadgeCheck className="mt-0.5 size-5 text-brand" aria-hidden />
          <div>
            <h2 className="font-semibold">{s.verifiedTitle}</h2>
            <p className="text-sm text-muted-foreground">{s.verifiedBody}</p>
          </div>
          <Badge tone="warn" className="ms-auto">
            Phase 3
          </Badge>
        </Card>
      ) : (
        <Card className="flex items-start gap-3">
          <Hourglass className="mt-0.5 size-5 text-accent" aria-hidden />
          <div>
            <h2 className="font-semibold">{s.pendingTitle}</h2>
            <p className="text-sm text-muted-foreground">{s.pendingBody}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
