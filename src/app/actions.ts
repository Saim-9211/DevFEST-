"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, getLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

export async function toggleLocale() {
  const next = (await getLocale()) === "ur" ? "en" : "ur";
  (await cookies()).set(LOCALE_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });

  // Remember the preference on the profile too (used for notifications later).
  const ctx = await getSessionContext();
  if (ctx) {
    const supabase = await createClient();
    await supabase.from("profiles").update({ locale: next }).eq("id", ctx.userId);
  }
  revalidatePath("/", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
