/**
 * Creates the demo accounts (one per role) and links them to the seeded buildings and suppliers.
 * Idempotent: safe to run more than once.
 *
 *   npm run seed:users
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, and supabase/seed.sql
 * already applied. The service-role key bypasses RLS: keep it server-side and never commit it.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD ?? "BulkBasket#2026";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const GULBERG_HEIGHTS = "20000000-0000-0000-0000-000000000001";
const LIBERTY_RESIDENCY = "20000000-0000-0000-0000-000000000002";
const AL_MADINA = "30000000-0000-0000-0000-000000000001";
const SHAH_ALAM = "30000000-0000-0000-0000-000000000002";
const PUNJAB_FMCG = "30000000-0000-0000-0000-000000000003";

type DemoUser = {
  email: string;
  full_name: string;
  phone: string;
  role: "resident" | "supplier" | "admin";
  membership?: { building: string; flat: string; member_role: "resident" | "captain"; status: "approved" | "pending" };
  supplier?: string;
};

const users: DemoUser[] = [
  { email: "admin@demo.bulkbasket.pk", full_name: "Sana Malik (Ops)", phone: "+923001000001", role: "admin" },
  {
    email: "captain@demo.bulkbasket.pk", full_name: "Bilal Ahmed", phone: "+923001000002", role: "resident",
    membership: { building: GULBERG_HEIGHTS, flat: "A-101", member_role: "captain", status: "approved" },
  },
  {
    email: "ayesha@demo.bulkbasket.pk", full_name: "Ayesha Khan", phone: "+923001000003", role: "resident",
    membership: { building: GULBERG_HEIGHTS, flat: "A-204", member_role: "resident", status: "approved" },
  },
  {
    email: "usman@demo.bulkbasket.pk", full_name: "Usman Tariq", phone: "+923001000004", role: "resident",
    membership: { building: GULBERG_HEIGHTS, flat: "B-105", member_role: "resident", status: "approved" },
  },
  {
    email: "hamza@demo.bulkbasket.pk", full_name: "Hamza Siddiqui", phone: "+923001000005", role: "resident",
    membership: { building: GULBERG_HEIGHTS, flat: "C-310", member_role: "resident", status: "pending" },
  },
  {
    email: "fatima@demo.bulkbasket.pk", full_name: "Fatima Raza", phone: "+923001000006", role: "resident",
    membership: { building: LIBERTY_RESIDENCY, flat: "L-12", member_role: "captain", status: "approved" },
  },
  { email: "almadina@demo.bulkbasket.pk", full_name: "Imran Qureshi", phone: "+923001000011", role: "supplier", supplier: AL_MADINA },
  { email: "shahalam@demo.bulkbasket.pk", full_name: "Kashif Butt", phone: "+923001000012", role: "supplier", supplier: SHAH_ALAM },
  { email: "punjabfmcg@demo.bulkbasket.pk", full_name: "Naveed Akhtar", phone: "+923001000013", role: "supplier", supplier: PUNJAB_FMCG },
];

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(u: DemoUser): Promise<string> {
  const existing = await findUserId(u.email);
  if (existing) return existing;
  const { data, error } = await db.auth.admin.createUser({
    email: u.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name, phone: u.phone },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  for (const u of users) {
    const id = await ensureUser(u);

    const { error: profileError } = await db
      .from("profiles")
      .update({ full_name: u.full_name, phone: u.phone, role: u.role })
      .eq("id", id);
    if (profileError) throw profileError;

    if (u.membership) {
      const { error } = await db.from("building_members").upsert(
        {
          building_id: u.membership.building,
          user_id: id,
          flat_no: u.membership.flat,
          member_role: u.membership.member_role,
          status: u.membership.status,
        },
        { onConflict: "building_id,user_id" },
      );
      if (error) throw error;
    }

    if (u.supplier) {
      const { error } = await db
        .from("supplier_users")
        .upsert({ supplier_id: u.supplier, user_id: id }, { onConflict: "supplier_id,user_id" });
      if (error) throw error;
    }

    console.log(`✓ ${u.role.padEnd(8)} ${u.email}`);
  }
  console.log(`\nAll demo accounts use the password: ${password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
