# CollectiveCart

A demand-led, deposit-backed grocery buying network for apartment buildings in Pakistan. Residents of a building order their monthly staples at fixed prices and pay a deposit before a cutoff. Buildings that reach the monthly minimum have their combined demand bought directly from verified wholesalers, with one drop-off per building. Residents pay the balance at pickup and collect with a one-time code. CollectiveCart holds no speculative inventory and earns the spread between the wholesale cost and the offer price.

> **Savings are per basket, not per item.** Unbranded commodities (daal, rice, atta, spices) are offered 14–22% below retail. Branded goods (oil, tea, dairy), where wholesale margins are only 3–8%, are offered 4–8% below. The demo basket saves about **11%** overall.

**Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres + RLS, Auth, Storage, Realtime) · zod · Vitest · simulated Raast/JazzCash/Easypaisa gateway.

## How a monthly cycle works

```
draft ─► open ─► locked ─► ordered ─► dispatched ─► delivered ─► distributing ─► closed
          │        │          │            │            │              │              │
   residents   run_cutoff  issue POs   suppliers   ambassador    pickup: balance   no-shows
   order +     (minimum    (deposit-   dispatch    checks in     (online or agent  forfeit
   pay 20%     check,      backed      (auto-      drop-offs     cash) + OTP/QR    deposit
   deposit     refunds,    demand      advances)   (auto-        handover
               lots,       only)                   advances)
               suppliers)
 draft/open/locked ─► cancelled (every deposit refunded)
```

| Rule | Where it's enforced |
|---|---|
| Prices, totals, deposit (10–20%, rounded up) are computed by the server; client-sent values are ignored | `price_basket_item`, `_recalc_basket`, `guard_basket` |
| Payments are confirmed only by the signed gateway webhook (service role) | `confirm_payment` + `/api/payments/webhook` (HMAC-SHA256) |
| Unpaid orders are dropped at cutoff; buildings under the minimum (households **and** value) are cancelled and refunded | `run_cutoff` |
| Purchase orders cover deposit-backed demand from buildings that met the minimum, and only from **verified** suppliers' rate cards (the cheapest that covers the volume) | `run_cutoff`, `issue_purchase_orders` |
| Offers can't be priced below the best wholesale cost | `guard_offer` (loss guard) |
| **Only authorized agents collect cash**, only for their assigned buildings, recorded on the spot with a receipt number. Ambassadors can't record payments | `record_cash_payment` |
| Handover needs the balance paid in full plus the correct one-time code (hashed, 48h, 5 attempts) | `generate_pickup_otp`, `complete_handover` |
| Returns: damaged/expired only, photo required, within 48h. Claims ≤ Rs 500 are credited instantly; larger ones go to a building return batch for admin review | `file_damage_claim`, `resolve_claim` |
| A no-show forfeits the deposit; a second no-show switches the household to 100% upfront payment | `close_cycle` |
| Store credit (from refunds) is spent against the next deposit or balance | `apply_credit` |

## Roles

| Role | Can do |
|---|---|
| Resident | Order, pay the deposit, pay the balance, collect with OTP/QR, report damage, use credit |
| Building Ambassador | Approve neighbours, watch live progress toward the minimum, check in drop-offs, run the pickup desk. **Never handles cash** |
| Agent | Collect cash balances in assigned buildings (with receipts), hand over orders, see cash on hand |
| Supplier | Submit rate cards before cutoff, accept and dispatch purchase orders |
| Admin | Set up cycles and offers, run cutoff, override supplier choice, issue POs, reconcile agent cash, review returns, see KPIs |

Resident and ambassador screens are in **English and Urdu (RTL)**. The staff consoles (admin, supplier, agent) are English only.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Apply the database.** In the SQL Editor, run these in order:
   `supabase/migrations/20261107000100_schema.sql` → `20261107000200_security.sql` → `20261107000300_platform.sql` (claim-photo bucket + Realtime) → `supabase/seed.sql`.
   Or use the CLI: `npx supabase link --project-ref <ref>`, then `npx supabase db push`, then run `seed.sql`.
3. **Auth** (Dashboard → Authentication): turn off **Confirm email** for the demo, and add `http://localhost:3000/auth/callback` to the redirect URLs. SMS login additionally needs an SMS provider; email login works without one.
4. **Environment:** `cp .env.example .env.local`, then fill in the Supabase URL, publishable/anon key, **service-role key** (used for payment confirmation and seeding) and a `PAYMENT_WEBHOOK_SECRET`.
5. **Run:**
   ```bash
   npm install
   npm run seed:users   # demo accounts + 11 paid-deposit orders
   npm run dev          # http://localhost:3000
   ```

### Demo accounts (password `Collective#2026`, override with `DEMO_PASSWORD`)

| Email (`@demo.collectivecart.pk`) | Who |
|---|---|
| `admin@` | Admin (ops) |
| `ayesha@` | Resident, Clifton Towers A-204, **no order yet** (use her for the live demo) |
| `ambassador@` | Bilal, Ambassador of Clifton Towers (also has an order) |
| `usman@`, `sadia@`, `farhan@`, `nida@`, `zain@`, `mehwish@`, `omar@` | Clifton residents with deposits paid |
| `hamza@` | Clifton resident **pending** approval |
| `fatima@` (ambassador), `kashif@`, `rabia@` | Jauhar Heights, 3 orders: **below the minimum** |
| `agent@` | Kamran, cash agent for Clifton and Jauhar |
| `jodia@`, `saddar@` | Verified suppliers |
| `korangi@` | Unverified supplier (cheapest rate card, but never selected) |

Invite codes: `CLIF2026`, `JAUH2026`, `PECH2026`.

After seeding, Clifton has **8 households and about Rs 115k**, just under its Rs 120k minimum. Jauhar has 3 households.

### Demo script (about 6 minutes)

1. **Ayesha** opens the catalog and adds staples. The basket shows about 11% saved vs retail, a 20% deposit, and the balance due at pickup. She pays the deposit through the mock **Raast** checkout.
2. **Ambassador** dashboard: Clifton's progress bar turns green (9 households, over Rs 120k). It updates live.
3. **Admin**, control room → **Run cutoff**. Jauhar is auto-cancelled and refunded; Clifton's demand becomes lots with suppliers auto-selected (Korangi is skipped as unverified). The cycle page shows the margin per lot and the surplus stock. Then **Issue purchase orders**.
4. **jodia@ / saddar@** accept and dispatch their POs (the cycle moves on automatically). The **Ambassador** checks in both drop-offs. **Admin** clicks **Open pickup**.
5. **Ayesha** pays the balance with mock **JazzCash** and opens her pickup code and QR. The **Ambassador** enters the code and hands over. **Usman** has no online payment: the **agent** collects cash (receipt `RC-…`) and hands over.
6. **Ayesha** reports a damaged salt pack with a photo and gets instant credit. **Admin** closes the cycle: the households that didn't collect become no-shows and their deposits are forfeited. **Payments & cash** reconciles the agent's cash, and the KPIs show GMV, savings %, margin, refunds and forfeits.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Unit tests: pricing (basket totals, deposit split, margin, minimums), webhook signing, phone numbers |
| `npm run db:test` | Applies the migrations and seed to a scratch PostgreSQL and runs the full V2 business-rule and RLS suite (`supabase/tests/rls_test.sql`), covering the whole cycle end to end. Needs a plain PostgreSQL server; set `PGHOST`, `PGPORT`, `PGUSER` (defaults `localhost:54329`, `postgres`) |
| `npm run seed:users` | Demo accounts and paid-deposit orders (service-role key) |

## Payments

All gateways are **simulated**: `/resident/pay/[id]` plays the Raast/JazzCash/Easypaisa side and sends a **signed** event through the same handler as `/api/payments/webhook`. To go live, implement checkout creation in `src/lib/payments/gateway.ts` for each provider and point its callback at the webhook, translating its payload into a `GatewayEvent`. The database already rejects wrong amounts, late deposits and replayed events.

## Known limitations / next steps

- **Surplus stock.** Suppliers sell whole cartons and sacks, so leftover units are real working capital at building scale (shown as "surplus stock" in the KPIs). Options: rate cards with loose/broken-carton pricing, cluster-level pooling of leftovers, or offering surplus in the next cycle (not built yet).
- Notifications are in-app only. WhatsApp/SMS delivery is the next adapter to add.
- Cutoff runs from an admin button. Schedule it with `pg_cron` for production.
- Staff consoles aren't translated to Urdu.
