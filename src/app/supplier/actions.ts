"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const quoteSchema = z.object({
  price_per_bulk: z.coerce.number().positive("Enter a price").max(10_000_000),
  min_bulk_units: z.coerce.number().int().min(1).default(1),
  max_bulk_units: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1).nullable()),
});

/** Create/update this supplier's rate card line. RLS + trigger enforce verified supplier and open cycle. */
export async function saveQuote(cycleId: string, productId: string, formData: FormData) {
  const ctx = await requireArea("supplier");
  const q = quoteSchema.parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_quotes").upsert(
    {
      cycle_id: z.uuid().parse(cycleId),
      supplier_id: ctx.supplier!.id,
      product_id: z.uuid().parse(productId),
      price_per_bulk: q.price_per_bulk,
      min_bulk_units: q.min_bulk_units,
      max_bulk_units: q.max_bulk_units,
    },
    { onConflict: "cycle_id,supplier_id,product_id" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/supplier");
}

export async function updatePo(poId: string, status: "accepted" | "dispatched") {
  await requireArea("supplier");
  const supabase = await createClient();
  const { error } = await supabase.rpc("supplier_update_po", { p_po: z.uuid().parse(poId), p_status: status });
  if (error) throw new Error(error.message);
  revalidatePath("/supplier");
}
