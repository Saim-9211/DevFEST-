"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { normalizePkPhone } from "@/lib/phone";
import type { FormState } from "@/components/form";

const flat = z.string().trim().min(1, "Enter your flat number").max(20);

export async function joinWithCode(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ code: z.string().trim().min(4, "Enter the invite code").max(16), flat_no: flat })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("join_building_by_code", {
    p_code: parsed.data.code,
    p_flat_no: parsed.data.flat_no,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/resident");
}

export async function requestJoin(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ building_id: z.uuid("Choose your building"), flat_no: flat })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_join_building", {
    p_building: parsed.data.building_id,
    p_flat_no: parsed.data.flat_no,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/resident");
}

const supplierSchema = z.object({
  business_name: z.string().trim().min(3, "Enter your business name").max(120),
  city: z.string().trim().min(2, "Enter your city").max(60),
  contact_phone: z.string().trim(),
  ntn: z.string().trim().max(20).optional(),
  strn: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
});

export async function registerSupplier(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const phone = normalizePkPhone(parsed.data.contact_phone);
  if (!phone) return { error: "Enter a valid Pakistani mobile number, e.g. 03001234567" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_supplier", {
    p_business_name: parsed.data.business_name,
    p_city: parsed.data.city,
    p_contact_phone: phone,
    p_ntn: parsed.data.ntn || null,
    p_strn: parsed.data.strn || null,
    p_address: parsed.data.address || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/supplier");
}
