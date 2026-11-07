/**
 * End-to-end test against the REAL Supabase project and a RUNNING app (next start / next dev).
 *
 *   APP_URL=http://localhost:3000 PAYMENT_WEBHOOK_SECRET=<same as the app> npm run test:e2e
 *
 * Part 1 - UI: submits the real login form for each demo role and checks the landing dashboard.
 * Part 2 - Flow: runs a whole monthly cycle as the real demo users in a TEMPORARY cycle
 *          (order -> deposit via signed webhook -> cutoff with a refunded building -> POs ->
 *          dispatch -> check-in -> pickup (online balance + agent cash) -> photo claim -> close),
 *          checking security rules along the way.
 * Cleanup: everything the test creates is deleted, so the seeded demo state is untouched.
 *
 * Needs: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY), SUPABASE_SERVICE_ROLE_KEY,
 * and the demo accounts from `npm run seed:users`.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "dev-only-insecure-secret";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Collective#2026";
const D = "demo.collectivecart.pk";
const DEMO_CYCLE = "40000000-0000-0000-0000-000000000001";
const CLUSTER = "10000000-0000-0000-0000-000000000001";

if (!URL_ || !KEY || !SERVICE) {
  console.error("Missing Supabase env vars (see .env.example).");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let passed = 0;
let failed = 0;
const ok = (label) => {
  passed++;
  console.log(`  ✓ ${label}`);
};
const bad = (label, detail) => {
  failed++;
  console.log(`  ✗ ${label}${detail ? ` -> ${detail}` : ""}`);
};
const expect = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));
async function expectError(promise, label) {
  const { error } = await promise;
  expect(Boolean(error), label, error ? undefined : "succeeded but should have failed");
  if (error) console.log(`      (${error.message})`);
}
function must(r, what) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const clients = new Map();
async function as(name) {
  if (clients.has(name)) return clients.get(name);
  const c = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await c.auth.signInWithPassword({ email: `${name}@${D}`, password: PASSWORD }), `login ${name}`);
  clients.set(name, c);
  return c;
}

/** Log in through the app's real login form (server action, no JS) and return the session cookie header. */
async function loginViaForm(email, password) {
  const page = await fetch(`${APP}/login`);
  const html = await page.text();
  const form = html.match(/<form[^>]*>[\s\S]*?name="email"[\s\S]*?<\/form>/)?.[0];
  if (!form) throw new Error("login form not found");
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = m[0].match(/name="([^"]*)"/)?.[1];
    const value = m[0].match(/value="([^"]*)"/)?.[1] ?? "";
    if (name) fd.append(name, value.replaceAll("&amp;", "&").replaceAll("&quot;", '"'));
  }
  fd.set("email", email);
  fd.set("password", password);
  const res = await fetch(`${APP}/login`, { method: "POST", body: fd, redirect: "manual" });
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).filter((c) => !c.endsWith("="));
  return { status: res.status, location: res.headers.get("location"), cookie: cookies.join("; "), body: res.status === 200 ? await res.text() : "" };
}

/** Session cookies for SSR without the form (used for page checks). */
async function cookieFor(email) {
  const jar = new Map();
  const c = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  must(await c.auth.signInWithPassword({ email, password: PASSWORD }), `ssr login ${email}`);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function getPage(path, cookie) {
  const res = await fetch(`${APP}${path}`, { headers: { cookie }, redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  const redirect = res.headers.get("location") ?? body.match(/NEXT_REDIRECT;[^;]*;([^;]*);/)?.[1] ?? null;
  return { status: res.status, body, redirect };
}

async function webhook(paymentId) {
  const p = must(await admin.from("payments").select("provider_ref, amount, method").eq("id", paymentId).single(), "payment");
  const body = JSON.stringify({ provider_ref: p.provider_ref, amount: Number(p.amount), status: "success", method: p.method, occurred_at: new Date().toISOString() });
  const sig = createHmac("sha256", SECRET).update(body).digest("hex");
  const res = await fetch(`${APP}/api/payments/webhook`, { method: "POST", body, headers: { "x-signature": sig, "content-type": "application/json" } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------------
// Part 1: UI login + dashboards
// ---------------------------------------------------------------------------
async function partUi() {
  console.log("\nPart 1: login form and role dashboards");

  const wrong = await loginViaForm(`ayesha@${D}`, "wrong-password");
  expect(wrong.status === 200 && /Invalid login credentials/i.test(wrong.body), "wrong password shows an error", `status ${wrong.status}`);

  const good = await loginViaForm(`ayesha@${D}`, PASSWORD);
  expect([303, 307, 302].includes(good.status) && good.cookie.includes("auth-token"), "correct password logs in and sets the session cookie", `status ${good.status}`);
  expect(good.location?.includes("/dashboard"), "login redirects to /dashboard", good.location);
  if (good.cookie) {
    const dash = await getPage("/dashboard", good.cookie);
    expect(dash.redirect === "/resident", "/dashboard sends a resident to /resident", dash.redirect ?? `status ${dash.status}`);
  }

  const checks = [
    ["ayesha", "/resident", "Ayesha Khan"],
    ["ayesha", "/resident/catalog", "Chakki Atta 10 kg"],
    ["ambassador", "/ambassador", "CLIF2026"],
    ["agent", "/agent", "Agent console"],
    ["jodia", "/supplier", "Jodia Bazaar Wholesale Co."],
    ["admin", "/admin", "Control room"],
  ];
  for (const [who, path, text] of checks) {
    const cookie = await cookieFor(`${who}@${D}`);
    const r = await getPage(path, cookie);
    expect(r.status === 200 && !r.redirect && r.body.includes(text), `${who} sees ${path}`, r.redirect ? `redirected to ${r.redirect}` : `status ${r.status}`);
  }
  const amb = await getPage("/admin", await cookieFor(`ambassador@${D}`));
  expect(amb.redirect && amb.redirect !== "/admin", "a non-admin is kept out of /admin", amb.redirect ?? "not redirected");
}

// ---------------------------------------------------------------------------
// Part 2: full monthly cycle in a temporary cycle
// ---------------------------------------------------------------------------
const created = { cycle: null, photoPath: null };

async function partFlow() {
  console.log("\nPart 2: full monthly cycle (temporary cycle, cleaned up afterwards)");
  const now = Date.now();
  // open_at is older than the demo cycle's, so the app's "current cycle" stays the demo one.
  const cycle = must(
    await admin
      .from("buying_cycles")
      .insert({
        cluster_id: CLUSTER, name: "E2E test cycle", status: "open", deposit_pct: 20, min_households: 2, min_order_value: 1000,
        open_at: new Date(now - 10 * 86400e3).toISOString(), cutoff_at: new Date(now + 3600e3).toISOString(),
        delivery_date: new Date(now + 2 * 86400e3).toISOString().slice(0, 10),
      })
      .select("id")
      .single(),
    "create test cycle",
  ).id;
  created.cycle = cycle;
  const offers = must(await admin.from("cycle_offers").select("product_id, offer_price").eq("cycle_id", DEMO_CYCLE), "offers");
  must(await admin.from("cycle_offers").insert(offers.map((o) => ({ ...o, cycle_id: cycle }))), "copy offers");
  const quotes = must(await admin.from("supplier_quotes").select("supplier_id, product_id, price_per_bulk, min_bulk_units, max_bulk_units").eq("cycle_id", DEMO_CYCLE), "quotes");
  must(await admin.from("supplier_quotes").insert(quotes.map((q) => ({ ...q, cycle_id: cycle }))), "copy quotes");
  const products = new Map(must(await admin.from("products").select("id, name_en"), "products").map((p) => [p.name_en, p.id]));
  const buildingOf = async (who) =>
    must(await (await as(who)).from("building_members").select("building_id").eq("status", "approved").limit(1).single(), "membership").building_id;

  // Order + deposit (+ cheating attempts)
  async function orderAndPay(who, items, method) {
    const c = await as(who);
    const { data: u } = await c.auth.getUser();
    const basket = must(
      await c.from("baskets").insert({ cycle_id: cycle, user_id: u.user.id, building_id: await buildingOf(who), status: "confirmed", amount_paid: 99999 }).select("id, status, amount_paid").single(),
      `${who} basket`,
    );
    expect(basket.status === "draft" && Number(basket.amount_paid) === 0, `${who}: client can't pre-confirm or pre-pay a basket`);
    for (const [name, qty] of Object.entries(items)) {
      must(await c.from("basket_items").insert({ basket_id: basket.id, product_id: products.get(name), qty, unit_price: 1 }), `${who} item`);
    }
    const b = must(await c.from("baskets").select("total, retail_total, deposit_due").eq("id", basket.id).single(), "totals");
    expect(Number(b.total) > 1 && Number(b.deposit_due) === Math.ceil(Number(b.total) * 0.2), `${who}: server priced the basket (Rs ${b.total}, deposit Rs ${b.deposit_due})`);
    must(await c.rpc("place_order", { p_basket: basket.id }), "place_order");
    const pay = must(await c.rpc("start_payment", { p_basket: basket.id, p_kind: "deposit", p_method: method }), "start_payment");
    await expectError(c.rpc("confirm_payment", { p_provider_ref: "x", p_amount: 1 }), `${who}: can't confirm own payment`);
    const hook = await webhook(pay);
    expect(hook.status === 200 && hook.json?.state === "verified", `${who}: deposit confirmed via signed webhook (${method})`, JSON.stringify(hook.json));
    return basket.id;
  }
  const ayeshaB = await orderAndPay("ayesha", { "Chakki Atta 10 kg": 2, "Iodized Salt 800 g": 2, "Daal Chana 1 kg": 3 }, "raast");
  const usmanB = await orderAndPay("usman", { "Sugar 5 kg": 2, "Cooking Oil 5 L": 1 }, "jazzcash");
  const kashifB = await orderAndPay("kashif", { "Chakki Atta 10 kg": 3 }, "easypaisa");

  // Tampered webhook
  const tampered = await fetch(`${APP}/api/payments/webhook`, { method: "POST", body: '{"provider_ref":"x","amount":1,"status":"success"}', headers: { "x-signature": "00" } });
  expect(tampered.status === 401, "unsigned/tampered webhook rejected (401)", `status ${tampered.status}`);

  // Visibility
  const usmanSees = must(await (await as("usman")).from("baskets").select("id").eq("cycle_id", cycle), "usman baskets");
  expect(usmanSees.length === 1, "a resident sees only their own order");
  const supSees = must(await (await as("jodia")).from("baskets").select("id"), "supplier baskets");
  expect(supSees.length === 0, "a supplier sees no household orders");

  // Cutoff
  const adm = await as("admin");
  await expectError((await as("ayesha")).rpc("run_cutoff", { p_cycle: cycle }), "a resident can't run cutoff");
  const cut = must(await adm.rpc("run_cutoff", { p_cycle: cycle }), "run_cutoff");
  expect(cut.buildings_met === 1 && cut.buildings_missed === 1 && cut.lots_without_quote === 0, `cutoff: 1 building met, 1 missed (${JSON.stringify(cut)})`);
  const kb = must(await admin.from("baskets").select("status, payment_status").eq("id", kashifB).single(), "kashif");
  expect(kb.status === "cancelled" && kb.payment_status === "refunded", "below-minimum building cancelled and deposit refunded");

  // Purchase orders, dispatch, check-in
  const pos = must(await adm.rpc("issue_purchase_orders", { p_cycle: cycle }), "issue POs");
  expect(pos >= 1, `${pos} purchase order(s) issued`);
  for (const sup of ["jodia", "saddar"]) {
    const c = await as(sup);
    const mine = must(await c.from("purchase_orders").select("id").eq("cycle_id", cycle), "pos");
    for (const po of mine) {
      must(await c.rpc("supplier_update_po", { p_po: po.id, p_status: "accepted" }), "accept");
      must(await c.rpc("supplier_update_po", { p_po: po.id, p_status: "dispatched" }), "dispatch");
    }
  }
  const amb = await as("ambassador");
  const dels = must(await amb.from("deliveries").select("id, po:purchase_orders!inner(cycle_id)").eq("po.cycle_id", cycle), "deliveries");
  for (const d of dels) must(await amb.rpc("check_in_delivery", { p_delivery: d.id, p_notes: "e2e" }), "check-in");
  const st = must(await admin.from("buying_cycles").select("status").eq("id", cycle).single(), "status").status;
  expect(st === "delivered", "suppliers dispatched + ambassador checked in -> cycle delivered", st);
  must(await adm.rpc("start_distribution", { p_cycle: cycle }), "start_distribution");

  // Pickup: Ayesha pays online, ambassador hands over
  const ay = await as("ayesha");
  const code = must(await ay.rpc("generate_pickup_otp", { p_basket: ayeshaB }), "otp");
  await expectError(amb.rpc("complete_handover", { p_basket: ayeshaB, p_code: code }), "no handover before the balance is paid");
  const bal = must(await ay.rpc("start_payment", { p_basket: ayeshaB, p_kind: "balance", p_method: "jazzcash" }), "balance");
  expect((await webhook(bal)).json?.state === "verified", "balance paid online via webhook");
  await expectError(amb.rpc("complete_handover", { p_basket: ayeshaB, p_code: "000000" }), "wrong pickup code rejected");
  must(await amb.rpc("complete_handover", { p_basket: ayeshaB, p_code: code }), "handover");
  ok("ayesha: handed over by the ambassador with the OTP");

  // Pickup: Usman pays cash to the agent
  await expectError(amb.rpc("record_cash_payment", { p_basket: usmanB }), "the ambassador can't take cash");
  const receipt = must(await (await as("agent")).rpc("record_cash_payment", { p_basket: usmanB }), "cash");
  expect(/^RC-/.test(receipt), `agent recorded cash with receipt ${receipt}`);
  const ucode = must(await (await as("usman")).rpc("generate_pickup_otp", { p_basket: usmanB }), "otp");
  must(await (await as("agent")).rpc("complete_handover", { p_basket: usmanB, p_code: ucode }), "agent handover");
  ok("usman: handed over by the agent");

  // Photo claim -> instant credit
  const { data: me } = await ay.auth.getUser();
  created.photoPath = `${me.user.id}/e2e-${randomUUID()}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  must(await ay.storage.from("claim-photos").upload(created.photoPath, png, { contentType: "image/png" }), "photo upload");
  const salt = must(await ay.from("basket_items").select("id, unit_price").eq("basket_id", ayeshaB).eq("product_id", products.get("Iodized Salt 800 g")).single(), "salt");
  const before = Number(must(await ay.rpc("credit_balance"), "credit"));
  must(await ay.rpc("file_damage_claim", { p_item: salt.id, p_type: "damaged", p_qty: 1, p_photo_path: created.photoPath, p_note: "e2e" }), "claim");
  const after = Number(must(await ay.rpc("credit_balance"), "credit"));
  expect(after - before === Number(salt.unit_price), `photo claim (Rs ${salt.unit_price}) credited instantly`);

  // Close + KPIs
  const closed = must(await adm.rpc("close_cycle", { p_cycle: cycle }), "close");
  expect(closed.no_shows === 0, "cycle closed with no no-shows");
  const k = must(await adm.rpc("admin_cycle_kpis", { p_cycle: cycle }), "kpis");
  expect(Number(k.margin) > 0 && k.collected === 2, `KPIs: GMV Rs ${k.gmv}, margin Rs ${k.margin} (${k.margin_pct}%), refunded Rs ${k.refunded}`);
}

// ---------------------------------------------------------------------------
// Cleanup: remove everything the flow created
// ---------------------------------------------------------------------------
async function cleanup() {
  if (!created.cycle) return;
  const baskets = must(await admin.from("baskets").select("id").eq("cycle_id", created.cycle), "baskets").map((b) => b.id);
  if (baskets.length) {
    const pays = must(await admin.from("payments").select("id").in("basket_id", baskets), "payments").map((p) => p.id);
    const items = must(await admin.from("basket_items").select("id").in("basket_id", baskets), "items").map((i) => i.id);
    const disputes = items.length ? must(await admin.from("disputes").select("id").in("basket_item_id", items), "disputes").map((d) => d.id) : [];
    if (pays.length) must(await admin.from("credit_ledger").delete().in("payment_id", pays), "ledger(p)");
    if (disputes.length) must(await admin.from("credit_ledger").delete().in("dispute_id", disputes), "ledger(d)");
    for (const id of baskets) must(await admin.from("notifications").delete().filter("payload->>basket_id", "eq", id), "notifications");
  }
  if (created.photoPath) await admin.storage.from("claim-photos").remove([created.photoPath]);
  must(await admin.from("buying_cycles").delete().eq("id", created.cycle), "delete cycle");
  const left = must(await admin.from("baskets").select("id").eq("cycle_id", created.cycle), "check");
  console.log(`\nCleanup: temporary cycle and ${baskets.length} test orders removed${left.length ? " (INCOMPLETE)" : ""}.`);
}

try {
  await partUi();
  await partFlow();
} catch (e) {
  bad("unexpected error", e.message);
} finally {
  await cleanup().catch((e) => console.log(`Cleanup failed: ${e.message}`));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
