import type { Metadata } from "next";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/primitives";
import { resolveClaim } from "../actions";

export const metadata: Metadata = { title: "Returns" };

type Claim = {
  id: string;
  type: string;
  qty: number;
  claim_amount: number;
  route: string;
  status: string;
  photo_path: string;
  note: string | null;
  created_at: string;
  item: { product: { name_en: string } };
  batch: { building: { name: string } } | null;
};

export default async function AdminReturns() {
  await requireArea("admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("disputes")
    .select(
      "id, type, qty, claim_amount, route, status, photo_path, note, created_at, item:basket_items(product:products(name_en)), batch:return_batches(building:buildings(name))",
    )
    .order("created_at", { ascending: false });
  const claims = (data ?? []) as unknown as Claim[];

  // Short-lived signed URLs for photo evidence (private bucket).
  const { data: signed } = claims.length
    ? await supabase.storage.from("claim-photos").createSignedUrls(claims.map((c) => c.photo_path), 600)
    : { data: [] };
  const urlFor = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl as string]));

  const open = claims.filter((c) => c.status === "open");
  const autoTotal = claims.filter((c) => c.route === "auto_refund").reduce((s, c) => s + Number(c.claim_amount), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Returns: damaged & expired</h1>
      <p className="text-sm text-muted-foreground">
        Claims up to Rs 500 are credited instantly on photo evidence ({formatPKR(autoTotal)} so far). Larger claims wait here until the building&apos;s
        return batch is inspected.
      </p>

      <Card className="space-y-3">
        <CardTitle>Batch claims awaiting decision · {open.length}</CardTitle>
        <ClaimList claims={open} urlFor={urlFor} actionable />
      </Card>

      <Card className="space-y-3">
        <CardTitle>All claims</CardTitle>
        <ClaimList claims={claims.filter((c) => c.status !== "open")} urlFor={urlFor} />
      </Card>
    </div>
  );
}

function ClaimList({ claims, urlFor, actionable }: { claims: Claim[]; urlFor: Map<string | null, string>; actionable?: boolean }) {
  if (claims.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="divide-y divide-border">
      {claims.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div>
            <p className="font-medium">
              {c.item.product.name_en} × {c.qty} · {c.type} · {formatPKR(Number(c.claim_amount))}
            </p>
            <p className="text-muted-foreground">
              {c.batch?.building.name ?? "Instant credit"} · {new Date(c.created_at).toLocaleString("en-PK")}
              {c.note ? ` · "${c.note}"` : ""}
              {urlFor.get(c.photo_path) ? (
                <>
                  {" · "}
                  <a href={urlFor.get(c.photo_path)} target="_blank" rel="noreferrer" className="text-brand underline">
                    photo
                  </a>
                </>
              ) : null}
            </p>
          </div>
          {actionable ? (
            <div className="flex gap-2">
              <form action={resolveClaim.bind(null, c.id, true)}>
                <Button size="sm">Approve & credit</Button>
              </form>
              <form action={resolveClaim.bind(null, c.id, false)}>
                <Button size="sm" variant="secondary">
                  Reject
                </Button>
              </form>
            </div>
          ) : (
            <Badge tone={c.status === "refunded" ? "brand" : "danger"}>{c.route === "auto_refund" ? "instant credit" : c.status}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
