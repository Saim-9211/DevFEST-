# BulkBasket

Community grocery group-buying for apartment buildings in Pakistan. Residents of a building pool their monthly orders. The platform combines demand across nearby buildings, verified wholesalers bid on it, and households get wholesale-level prices delivered to their building.

> The 20–30% saving is a **target**. The app always shows an *estimated* price first; the final price comes from supplier bids.

**Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres + RLS, Auth) · zod · Vitest.

## Status: Phase 1 (Foundation) is done

| Area | What works |
|---|---|
| Database | Full schema for all phases, RLS on every table, guard triggers, RPCs, cycle state machine with audit log |
| Auth | Email + password sign-up and login. SMS one-time-code login (needs an SMS provider in Supabase). Every new account starts as a resident; metadata cannot grant a role |
| Roles | Resident, Building Captain, Supplier, Admin. Each area has a server-side guard; RLS enforces the same rules in the database |
| Onboarding | Join a building by invite code or request to join. Register a supplier business (unverified until an admin verifies it) |
| Resident | Membership status (pending / approved / rejected) and the current cycle with cutoff countdown |
| Captain | Invite code, approve or reject pending households, member list |
| Supplier | Verification status |
| Admin | Platform counts, verify suppliers, move cycles through the state machine (only legal moves are offered) |
| i18n | English and Urdu (Nastaliq font, RTL), toggled from the header |
| Seed | 13 categories, 55 Pakistani staples with retail benchmarks and tier estimates, 1 Lahore cluster, 3 buildings, 3 suppliers, 1 open cycle, 9 demo accounts |

Next up: **Phase 2** (catalog, basket, live building demand), then Phase 3 (aggregation, bidding, award), Phase 4 (delivery, OTP handover, disputes), Phase 5 (analytics, polish). Payments are deliberately out of scope for now: baskets carry a `payment_status` placeholder that defaults to cash on delivery.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Apply the database.** In the Supabase SQL Editor, run these files in order:
   1. `supabase/migrations/20261107000100_schema.sql`
   2. `supabase/migrations/20261107000200_security.sql`
   3. `supabase/seed.sql`

   Or use the CLI (no Docker needed for a remote project): `npx supabase login`, `npx supabase init`, `npx supabase link --project-ref <ref>`, `npx supabase db push`, then run `seed.sql` in the SQL Editor.
3. **Auth settings** (Dashboard → Authentication):
   - For a smooth demo, turn off **Confirm email** under Providers → Email.
   - Add `http://localhost:3000/auth/callback` to the redirect URLs.
   - SMS login needs **Phone** enabled with an SMS provider (e.g. Twilio). Email login works without it.
4. **Environment:** `cp .env.example .env.local` and fill in the URL, the publishable (or anon) key, and the service-role key.
5. **Install, create demo users and run:**
   ```bash
   npm install
   npm run seed:users   # creates the demo accounts below
   npm run dev          # http://localhost:3000
   ```

### Demo accounts (password `BulkBasket#2026`, override with `DEMO_PASSWORD`)

| Email | Role |
|---|---|
| `admin@demo.bulkbasket.pk` | Admin (ops) |
| `captain@demo.bulkbasket.pk` | Captain, Gulberg Heights, flat A-101 |
| `ayesha@demo.bulkbasket.pk` | Resident, Gulberg Heights, A-204 |
| `usman@demo.bulkbasket.pk` | Resident, Gulberg Heights, B-105 |
| `hamza@demo.bulkbasket.pk` | Resident, **pending** approval (C-310) |
| `fatima@demo.bulkbasket.pk` | Captain, Liberty Residency, L-12 |
| `almadina@demo.bulkbasket.pk` | Supplier (verified) |
| `shahalam@demo.bulkbasket.pk` | Supplier (verified) |
| `punjabfmcg@demo.bulkbasket.pk` | Supplier (**unverified**, so the admin can verify it live) |

Building invite codes: `GULB2026`, `LIBR2026`, `MALL2026`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Unit tests (pricing math, phone normalisation) |
| `npm run db:test` | Applies migrations and seed to a scratch PostgreSQL database and runs the RLS / business-rule suite (`supabase/tests/rls_test.sql`). Needs a plain PostgreSQL server; set `PGHOST`, `PGPORT`, `PGUSER` (defaults: `localhost:54329`, `postgres`) |
| `npm run seed:users` | Creates or updates the demo accounts (uses the service-role key) |

## How it's built

```
src/
  proxy.ts                  session refresh + optimistic redirect for protected areas (Next 16 "proxy" = middleware)
  app/
    page.tsx                landing page
    (auth)/login, signup    email/password + SMS one-time code
    auth/callback           email-confirmation code exchange
    onboarding/             join building / register supplier
    resident/ captain/ supplier/ admin/   role areas; each layout calls requireArea()
  lib/
    auth.ts                 session context, role helpers, requireArea()
    pricing.ts              tier and savings math (mirrors the SQL)
    i18n/                   en/ur dictionaries, locale cookie
    supabase/               server, browser and proxy clients
supabase/
  migrations/               schema, security (RLS, triggers, RPCs)
  seed.sql                  demo catalog and data
  tests/                    local Supabase shim + RLS test suite
scripts/seed-users.ts       demo accounts
```

### Security model

- **RLS everywhere.** Residents see only their own baskets, captains see only their own building, and suppliers never see resident identities or household orders.
- **Server-computed fields.** Estimated prices, final prices, verification flags, roles and basket/payment status are set by triggers or security-definer RPCs. Client-supplied values are overwritten or rejected.
- **One household per flat.** A partial unique index blocks duplicate or fake sign-ups for the same flat.
- **Audited state machine.** Buying cycles can only move along the edges in `cycle_transitions`, and every move is written to `cycle_events`.
- **Service-role key stays server-side.** It is used only by `scripts/seed-users.ts`, never by the app.
