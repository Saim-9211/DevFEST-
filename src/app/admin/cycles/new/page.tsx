import type { Metadata } from "next";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, Select } from "@/components/ui/primitives";
import { createCycle } from "../../actions";

export const metadata: Metadata = { title: "New cycle" };

const iso = (d: Date) => d.toISOString().slice(0, 16);

export default async function NewCycle() {
  await requireArea("admin");
  const supabase = await createClient();
  const { data: clusters } = await supabase.from("clusters").select("id, name, city").order("name");
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9);
  const cutoff = new Date(next.getFullYear(), next.getMonth(), 5, 23, 59);
  const delivery = new Date(next.getFullYear(), next.getMonth(), 9);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">New buying cycle</h1>
      <p className="text-sm text-muted-foreground">
        Created as a draft. Offer prices are copied from the cluster&apos;s previous cycle; review them against suppliers&apos; rate cards before opening.
      </p>
      <Card>
        <ActionForm action={createCycle}>
          <Field label="Cluster">
            <Select name="cluster_id" required>
              {(clusters ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.city})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input name="name" defaultValue={`${next.toLocaleString("en", { month: "long" })} ${next.getFullYear()} Monthly Order`} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Opens">
              <Input name="open_at" type="datetime-local" defaultValue={iso(next)} required />
            </Field>
            <Field label="Cutoff">
              <Input name="cutoff_at" type="datetime-local" defaultValue={iso(cutoff)} required />
            </Field>
            <Field label="Delivery date">
              <Input name="delivery_date" type="date" defaultValue={delivery.toISOString().slice(0, 10)} required />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Deposit % (10–20)">
              <Input name="deposit_pct" type="number" min={10} max={20} defaultValue={20} required />
            </Field>
            <Field label="Min households / building">
              <Input name="min_households" type="number" min={1} defaultValue={8} required />
            </Field>
            <Field label="Min order value / building (Rs)">
              <Input name="min_order_value" type="number" min={0} step={1000} defaultValue={120000} required />
            </Field>
          </div>
          <SubmitButton>Create draft cycle</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
