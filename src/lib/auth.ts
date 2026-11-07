import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export type AppRole = "resident" | "supplier" | "admin";

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: AppRole;
  locale: "en" | "ur";
};

export type Membership = {
  id: string;
  building_id: string;
  flat_no: string;
  member_role: "resident" | "captain";
  status: "pending" | "approved" | "rejected";
  building: { id: string; name: string; city: string; cluster_id: string | null; total_flats: number };
};

export type SupplierLink = { id: string; business_name: string; verified: boolean; city: string };

export type SessionContext = {
  userId: string;
  email: string | null;
  profile: Profile;
  memberships: Membership[];
  supplier: SupplierLink | null;
};

/** Signed-in user's profile, memberships and supplier link. Cached per request. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const [{ data: profile }, { data: memberships }, { data: supplierRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, locale").eq("id", user.id).single(),
    supabase
      .from("building_members")
      .select("id, building_id, flat_no, member_role, status, building:buildings(id, name, city, cluster_id, total_flats)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("supplier_users")
      .select("supplier:suppliers(id, business_name, verified, city)")
      .eq("user_id", user.id)
      .limit(1),
  ]);

  if (!profile) return null; // profile row is created by a DB trigger on sign-up

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: profile as Profile,
    memberships: (memberships ?? []) as unknown as Membership[],
    supplier: ((supplierRows?.[0]?.supplier ?? null) as unknown as SupplierLink | null),
  };
});

/** The building membership the household acts through (approved first, then most recent). */
export function activeMembership(ctx: SessionContext): Membership | undefined {
  return ctx.memberships.find((m) => m.status === "approved") ?? ctx.memberships[0];
}

export function isCaptain(ctx: SessionContext): boolean {
  return ctx.memberships.some((m) => m.member_role === "captain" && m.status === "approved");
}

/** Where a signed-in user lands. */
export function homePath(ctx: SessionContext): string {
  if (ctx.profile.role === "admin") return "/admin";
  if (ctx.supplier) return "/supplier";
  if (ctx.memberships.length === 0) return "/onboarding";
  return "/resident";
}

type Area = "resident" | "captain" | "supplier" | "admin";

/** Server-side guard for an area's layout. Redirects instead of rendering for the wrong role. */
export async function requireArea(area: Area): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=/${area}`);

  const allowed =
    area === "admin"
      ? ctx.profile.role === "admin"
      : area === "supplier"
        ? Boolean(ctx.supplier)
        : area === "captain"
          ? isCaptain(ctx)
          : ctx.memberships.length > 0;

  if (!allowed) redirect(homePath(ctx));
  return ctx;
}
