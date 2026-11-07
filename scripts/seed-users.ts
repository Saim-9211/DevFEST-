/**
 * Creates the CollectiveCart demo accounts and sample orders. Idempotent: safe to re-run.
 *
 *   npm run seed:users
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, and supabase/seed.sql
 * already applied. The service-role key bypasses RLS: keep it server-side and never commit it.
 *
 * Demo state after seeding (cycle open):
 *   Clifton Towers : 8 households with deposits paid, ~Rs 114k -> just UNDER the Rs 120k minimum.
 *                    Ayesha's live order in the demo pushes it over.
 *   Jauhar Heights : 3 households with deposits paid -> will MISS the minimum and be refunded at cutoff.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD ?? "Collective#2026";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const CYCLE = "40000000-0000-0000-0000-000000000001";
const CLIFTON = "20000000-0000-0000-0000-000000000001";
const JAUHAR = "20000000-0000-0000-0000-000000000002";
const JODIA = "30000000-0000-0000-0000-000000000001";
const SADDAR = "30000000-0000-0000-0000-000000000002";
const KORANGI = "30000000-0000-0000-0000-000000000003";
const DOMAIN = "demo.collectivecart.pk";

type Basket = Record<string, number>; // product name_en -> qty

type DemoUser = {
  email: string;
  full_name: string;
  phone: string;
  role: "resident" | "supplier" | "agent" | "admin";
  membership?: { building: string; flat: string; member_role: "resident" | "ambassador"; status: "approved" | "pending" };
  supplier?: string;
  agentFor?: string[];
  basket?: { items: Basket; method: "raast" | "jazzcash" | "easypaisa" };
};

// A typical monthly basket of staples, ~Rs 14k at offer prices.
const monthly = (scale = 1): Basket => ({
  "Chakki Atta 10 kg": 2,
  "Super Kernel Basmati 5 kg": 1,
  "Sugar 5 kg": 2,
  "Cooking Oil 5 L": 1,
  "Danedar Tea 950 g": 1,
  "Daal Chana 1 kg": 2 * scale,
  "Daal Masoor 1 kg": 2,
  "UHT Full Cream Milk 1 L": 6,
  "Washing Powder 2 kg": 1,
});

const cliftonResidents: [string, string, string][] = [
  ["usman", "Usman Tariq", "B-105"],
  ["sadia", "Sadia Hussain", "B-207"],
  ["farhan", "Farhan Ali", "C-102"],
  ["nida", "Nida Shah", "C-204"],
  ["zain", "Zain Abbasi", "D-301"],
  ["mehwish", "Mehwish Iqbal", "D-402"],
  ["omar", "Omar Farooq", "E-110"],
];

const users: DemoUser[] = [
  { email: `admin@${DOMAIN}`, full_name: "Sana Malik (Ops)", phone: "+923001000001", role: "admin" },
  {
    email: `ambassador@${DOMAIN}`, full_name: "Bilal Ahmed", phone: "+923001000002", role: "resident",
    membership: { building: CLIFTON, flat: "A-101", member_role: "ambassador", status: "approved" },
    basket: { items: monthly(), method: "raast" },
  },
  {
    email: `ayesha@${DOMAIN}`, full_name: "Ayesha Khan", phone: "+923001000003", role: "resident",
    membership: { building: CLIFTON, flat: "A-204", member_role: "resident", status: "approved" },
  },
  ...cliftonResidents.map(([id, name, flat], i): DemoUser => ({
    email: `${id}@${DOMAIN}`, full_name: name, phone: `+9230010001${String(i).padStart(2, "0")}`, role: "resident",
    membership: { building: CLIFTON, flat, member_role: "resident", status: "approved" },
    basket: { items: monthly(i % 2 ? 2 : 1), method: (["raast", "jazzcash", "easypaisa"] as const)[i % 3] },
  })),
  {
    email: `hamza@${DOMAIN}`, full_name: "Hamza Siddiqui", phone: "+923001000005", role: "resident",
    membership: { building: CLIFTON, flat: "C-310", member_role: "resident", status: "pending" },
  },
  {
    email: `fatima@${DOMAIN}`, full_name: "Fatima Raza", phone: "+923001000006", role: "resident",
    membership: { building: JAUHAR, flat: "J-12", member_role: "ambassador", status: "approved" },
    basket: { items: monthly(), method: "jazzcash" },
  },
  {
    email: `kashif@${DOMAIN}`, full_name: "Kashif Mirza", phone: "+923001000007", role: "resident",
    membership: { building: JAUHAR, flat: "J-23", member_role: "resident", status: "approved" },
    basket: { items: monthly(), method: "easypaisa" },
  },
  {
    email: `rabia@${DOMAIN}`, full_name: "Rabia Naqvi", phone: "+923001000008", role: "resident",
    membership: { building: JAUHAR, flat: "J-31", member_role: "resident", status: "approved" },
    basket: { items: monthly(), method: "raast" },
  },
  { email: `agent@${DOMAIN}`, full_name: "Kamran Yousuf (Agent)", phone: "+923001000009", role: "agent", agentFor: [CLIFTON, JAUHAR] },
  { email: `jodia@${DOMAIN}`, full_name: "Imran Qureshi", phone: "+923001000011", role: "supplier", supplier: JODIA },
  { email: `saddar@${DOMAIN}`, full_name: "Asif Memon", phone: "+923001000012", role: "supplier", supplier: SADDAR },
  { email: `korangi@${DOMAIN}`, full_name: "Naveed Akhtar", phone: "+923001000013", role: "supplier", supplier: KORANGI },
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
    email: u.email, password, email_confirm: true, user_metadata: { full_name: u.full_name, phone: u.phone },
  });
  if (error) throw error;
  return data.user.id;
}

type Res<T> = { data: T; error: { message: string } | null };
function ok(r: { error: { message: string } | null }, what: string): void {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
}
function must<T>(r: Res<T>, what: string): NonNullable<T> {
  ok(r, what);
  if (r.data == null) throw new Error(`${what}: no data returned`);
  return r.data as NonNullable<T>;
}

/** Basket with a verified deposit, created exactly as the app + gateway webhook would. */
async function seedBasket(userId: string, building: string, items: Basket, method: string, productIds: Map<string, string>) {
  const lookup = await db.from("baskets").select("id").eq("cycle_id", CYCLE).eq("user_id", userId).maybeSingle();
  ok(lookup, "basket lookup");
  if (lookup.data) return "exists";

  const basket = must(
    await db.from("baskets").insert({ cycle_id: CYCLE, user_id: userId, building_id: building, status: "draft" }).select("id").single(),
    "basket",
  );
  ok(
    await db.from("basket_items").insert(
      Object.entries(items).map(([name, qty]) => {
        const pid = productIds.get(name);
        if (!pid) throw new Error(`Unknown product ${name}: run supabase/seed.sql first`);
        return { basket_id: basket.id, product_id: pid, qty };
      }),
    ),
    "items",
  );
  ok(await db.from("baskets").update({ status: "pending_deposit", placed_at: new Date().toISOString() }).eq("id", basket.id), "place");
  const b = must(await db.from("baskets").select("deposit_due").eq("id", basket.id).single(), "deposit");
  const ref = `SEED-${basket.id.slice(0, 8).toUpperCase()}`;
  ok(
    await db.from("payments").insert({ basket_id: basket.id, user_id: userId, kind: "deposit", method, amount: b.deposit_due, provider_ref: ref }),
    "payment",
  );
  const state = must(await db.rpc("confirm_payment", { p_provider_ref: ref, p_amount: Number(b.deposit_due) }), "confirm");
  return `deposit ${state}`;
}

async function main() {
  const products = must(await db.from("products").select("id, name_en"), "products");
  const productIds = new Map(products.map((p) => [p.name_en as string, p.id as string]));

  for (const u of users) {
    const id = await ensureUser(u);
    ok(await db.from("profiles").update({ full_name: u.full_name, phone: u.phone, role: u.role }).eq("id", id), "profile");

    if (u.membership) {
      ok(
        await db.from("building_members").upsert(
          { building_id: u.membership.building, user_id: id, flat_no: u.membership.flat, member_role: u.membership.member_role, status: u.membership.status },
          { onConflict: "building_id,user_id" },
        ),
        "membership",
      );
    }
    if (u.supplier) ok(await db.from("supplier_users").upsert({ supplier_id: u.supplier, user_id: id }, { onConflict: "supplier_id,user_id" }), "supplier link");
    for (const b of u.agentFor ?? []) ok(await db.from("agent_buildings").upsert({ agent_id: id, building_id: b }, { onConflict: "agent_id,building_id" }), "agent");

    let note = "";
    if (u.basket && u.membership) note = ` · basket ${await seedBasket(id, u.membership.building, u.basket.items, u.basket.method, productIds)}`;
    console.log(`✓ ${u.role.padEnd(8)} ${u.email}${note}`);
  }

  for (const [label, building] of [["Clifton Towers", CLIFTON], ["Jauhar Heights", JAUHAR]] as const) {
    const rows = must(await db.from("baskets").select("total").eq("cycle_id", CYCLE).eq("building_id", building).eq("status", "confirmed"), "progress");
    const value = rows.reduce((s, r) => s + Number(r.total), 0);
    console.log(`  ${label}: ${rows.length} households, Rs ${Math.round(value).toLocaleString("en-PK")} (minimum 8 / Rs 120,000)`);
  }
  console.log(`\nAll demo accounts use the password: ${password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
