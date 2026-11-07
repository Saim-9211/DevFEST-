"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured, missingSupabaseEnv } from "@/lib/env";
import { getDictionary } from "@/lib/i18n";
import { normalizePkPhone } from "@/lib/phone";
import type { FormState } from "@/components/form";

/** Only allow same-site relative redirects (blocks open redirects like //evil.com). */
function safeNext(value: FormDataEntryValue | null, fallback = "/dashboard") {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}

async function notConfigured(): Promise<FormState | null> {
  if (isSupabaseConfigured) return null;
  const { t } = await getDictionary();
  return { error: `${t.auth.notConfigured} ${missingSupabaseEnv().join(", ")}` };
}

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function signInWithPassword(_: FormState, formData: FormData): Promise<FormState> {
  const nc = await notConfigured();
  if (nc) return nc;
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };
  redirect(safeNext(formData.get("next")));
}

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().trim().optional(),
});

export async function signUp(_: FormState, formData: FormData): Promise<FormState> {
  const nc = await notConfigured();
  if (nc) return nc;
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let phone: string | undefined;
  if (parsed.data.phone) {
    const normalized = normalizePkPhone(parsed.data.phone);
    if (!normalized) return { error: "Enter a valid Pakistani mobile number, e.g. 03001234567" };
    phone = normalized;
  }

  const { locale } = await getDictionary();
  const asSupplier = formData.get("as") === "supplier";

  // Create the account already confirmed (no verification email), regardless of the
  // project's "Confirm email" setting. Needs the server-only service-role key.
  // Role is never taken from metadata; the DB trigger always creates a 'resident' profile.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Sign-up is not configured: SUPABASE_SERVICE_ROLE_KEY is missing on the server." };
  }
  const { error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name, phone, locale },
  });
  if (createError) {
    const exists = createError.status === 422 || /already/i.test(createError.message);
    return { error: exists ? "An account with this email already exists. Please log in." : createError.message };
  }

  // Sign the new user in right away (sets the session cookie).
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (signInError) return { error: signInError.message };
  redirect(asSupplier ? "/onboarding?as=supplier" : "/onboarding");
}

export async function sendPhoneOtp(_: FormState, formData: FormData): Promise<FormState> {
  const nc = await notConfigured();
  if (nc) return nc;
  const phone = normalizePkPhone(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Enter a valid Pakistani mobile number, e.g. 03001234567" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) return { error: error.message };
  const { t } = await getDictionary();
  return { success: t.auth.codeSent };
}

export async function verifyPhoneOtp(_: FormState, formData: FormData): Promise<FormState> {
  const nc = await notConfigured();
  if (nc) return nc;
  const phone = normalizePkPhone(String(formData.get("phone") ?? ""));
  const token = String(formData.get("token") ?? "").trim();
  if (!phone || !/^\d{6}$/.test(token)) return { error: "Enter the 6-digit code" };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) return { error: error.message };
  redirect(safeNext(formData.get("next")));
}
