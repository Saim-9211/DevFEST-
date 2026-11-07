import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Building2, Truck } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { getSessionContext, homePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardTitle, Field, Input, Select } from "@/components/ui/primitives";
import { joinWithCode, registerSupplier, requestJoin } from "./actions";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login?next=/onboarding");
  // Already set up: go home. Rejected residents may try again.
  const hasActiveMembership = ctx.memberships.some((m) => m.status !== "rejected");
  if (ctx.supplier || ctx.profile.role === "admin" || hasActiveMembership) redirect(homePath(ctx));

  const { t } = await getDictionary();
  const o = t.onboarding;
  const sp = await searchParams;
  const supplierFirst = sp.as === "supplier";

  const supabase = await createClient();
  const { data: buildings } = await supabase
    .from("buildings")
    .select("id, name, city")
    .order("city")
    .order("name");

  const residentCard = (
    <Card key="resident" className="space-y-5">
      <div className="flex items-start gap-3">
        <Building2 className="mt-1 size-6 text-brand" aria-hidden />
        <div>
          <CardTitle>{o.residentTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">{o.residentBody}</p>
        </div>
      </div>

      <ActionForm action={joinWithCode}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={o.inviteCode}>
            <Input name="code" placeholder="GULB2026" autoCapitalize="characters" required />
          </Field>
          <Field label={o.flatNo}>
            <Input name="flat_no" placeholder="A-204" required />
          </Field>
        </div>
        <SubmitButton className="w-full">{o.joinWithCode}</SubmitButton>
      </ActionForm>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">{o.orFind}</summary>
        <ActionForm action={requestJoin} className="mt-3 space-y-3">
          <Field label={o.building}>
            <Select name="building_id" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {(buildings ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.city})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={o.flatNo}>
            <Input name="flat_no" placeholder="A-204" required />
          </Field>
          <SubmitButton variant="secondary" className="w-full">
            {o.requestJoin}
          </SubmitButton>
        </ActionForm>
      </details>
    </Card>
  );

  const supplierCard = (
    <Card key="supplier" className="space-y-5">
      <div className="flex items-start gap-3">
        <Truck className="mt-1 size-6 text-brand" aria-hidden />
        <div>
          <CardTitle>{o.supplierTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">{o.supplierBody}</p>
        </div>
      </div>
      <ActionForm action={registerSupplier}>
        <Field label={o.businessName}>
          <Input name="business_name" required minLength={3} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={o.city}>
            <Input name="city" defaultValue="Lahore" required />
          </Field>
          <Field label={t.auth.phone} hint={t.auth.phoneHint}>
            <Input name="contact_phone" type="tel" defaultValue={ctx.profile.phone ?? ""} required />
          </Field>
          <Field label={o.ntn}>
            <Input name="ntn" />
          </Field>
          <Field label={o.strn}>
            <Input name="strn" />
          </Field>
        </div>
        <Field label={o.address}>
          <Input name="address" />
        </Field>
        <SubmitButton variant={supplierFirst ? "primary" : "secondary"} className="w-full">
          {o.registerSupplier}
        </SubmitButton>
      </ActionForm>
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{o.title}</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {supplierFirst ? [supplierCard, residentCard] : [residentCard, supplierCard]}
      </div>
    </div>
  );
}
