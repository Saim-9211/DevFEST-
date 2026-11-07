-- CollectiveCart core schema (V2)
-- Demand-aggregated, deposit-backed grocery procurement at apartment-building level.
-- Residents order fixed-price staples and pay a deposit before cutoff; buildings that miss the
-- minimum are cancelled and refunded; purchase orders are issued only for deposit-backed demand;
-- the balance is paid at pickup (online, or cash to an authorized agent).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('resident', 'supplier', 'agent', 'admin');
create type public.member_role as enum ('resident', 'ambassador');
create type public.member_status as enum ('pending', 'approved', 'rejected');
create type public.cycle_status as enum (
  'draft', 'open', 'locked', 'ordered', 'dispatched', 'delivered', 'distributing', 'closed', 'cancelled'
);
create type public.basket_status as enum (
  'draft', 'pending_deposit', 'confirmed', 'ready', 'collected', 'cancelled', 'no_show'
);
create type public.basket_payment_status as enum (
  'unpaid', 'deposit_paid', 'paid_in_full', 'refunded', 'forfeited'
);
create type public.payment_kind as enum ('deposit', 'balance', 'refund');
create type public.payment_method as enum ('raast', 'jazzcash', 'easypaisa', 'cash_agent', 'credit');
create type public.payment_state as enum ('pending', 'verified', 'failed', 'cancelled');
create type public.po_status as enum ('pending', 'accepted', 'dispatched', 'delivered', 'cancelled');
create type public.dispute_type as enum ('damaged', 'expired');
create type public.dispute_route as enum ('auto_refund', 'batch_return');
create type public.dispute_status as enum ('open', 'refunded', 'rejected');
create type public.return_batch_status as enum ('open', 'collected', 'closed');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'resident',
  locale text not null default 'en' check (locale in ('en', 'ur')),
  reliability_score numeric(5, 2) not null default 100,
  no_show_count integer not null default 0,
  upfront_only boolean not null default false, -- set after repeated no-shows: pay 100% at order
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Buildings, clusters, agents
-- ---------------------------------------------------------------------------
create table public.clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  created_at timestamptz not null default now()
);

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid references public.clusters (id) on delete set null,
  name text not null,
  address text not null,
  city text not null,
  lat numeric(9, 6),
  lng numeric(9, 6),
  total_flats integer not null default 0 check (total_flats >= 0),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index buildings_cluster_idx on public.buildings (cluster_id);

-- Invite codes live in their own table so ordinary members can't read them.
create table public.building_invites (
  building_id uuid primary key references public.buildings (id) on delete cascade,
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_at timestamptz not null default now()
);

create table public.building_members (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  flat_no text not null check (length(trim(flat_no)) between 1 and 20),
  member_role public.member_role not null default 'resident',
  status public.member_status not null default 'pending',
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (building_id, user_id)
);
-- One active household per flat: blocks duplicate/fake sign-ups for the same flat.
create unique index building_members_one_household_per_flat
  on public.building_members (building_id, lower(trim(flat_no)))
  where status in ('pending', 'approved');
create index building_members_user_idx on public.building_members (user_id);

-- Authorized logistics agents: the ONLY people allowed to collect cash.
create table public.agent_buildings (
  agent_id uuid not null references public.profiles (id) on delete cascade,
  building_id uuid not null references public.buildings (id) on delete cascade,
  primary key (agent_id, building_id)
);

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  ntn text,
  strn text,
  contact_phone text,
  contact_email text,
  address text,
  city text not null,
  service_cities text[] not null default '{}',
  verified boolean not null default false,
  rating numeric(3, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.supplier_users (
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (supplier_id, user_id)
);
create index supplier_users_user_idx on public.supplier_users (user_id);

-- ---------------------------------------------------------------------------
-- Catalog (20-30 non-perishable staples)
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_ur text not null,
  sort integer not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  name_en text not null,
  name_ur text not null,
  brand text,
  branded boolean not null default false, -- branded FMCG has thin wholesale margins (3-8%)
  image_url text,
  household_unit_label text not null,     -- what a family orders, e.g. "10 kg bag"
  bulk_unit_label text not null,          -- what a supplier sells, e.g. "50 kg sack"
  split_factor integer not null check (split_factor >= 1), -- household units per bulk unit
  reference_retail_price numeric(12, 2) not null check (reference_retail_price > 0), -- benchmark
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);

-- ---------------------------------------------------------------------------
-- Buying cycles, offers, supplier rate cards
-- ---------------------------------------------------------------------------
create table public.buying_cycles (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id),
  name text not null,
  open_at timestamptz not null,
  cutoff_at timestamptz not null,
  delivery_date date not null,
  status public.cycle_status not null default 'draft',
  deposit_pct numeric(5, 2) not null default 20 check (deposit_pct between 10 and 20),
  min_order_value numeric(14, 2) not null default 120000 check (min_order_value >= 0), -- per building
  min_households integer not null default 8 check (min_households >= 1),             -- per building
  created_at timestamptz not null default now(),
  check (open_at < cutoff_at)
);
create index buying_cycles_cluster_idx on public.buying_cycles (cluster_id, status);

-- Fixed resident price per SKU for a cycle (set by admin from rate cards).
create table public.cycle_offers (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  product_id uuid not null references public.products (id),
  offer_price numeric(12, 2) not null check (offer_price > 0), -- per household unit
  active boolean not null default true,
  unique (cycle_id, product_id)
);

-- Supplier rate cards: wholesale price per bulk unit, valid for a volume range.
create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.products (id),
  price_per_bulk numeric(12, 2) not null check (price_per_bulk > 0),
  min_bulk_units integer not null default 1 check (min_bulk_units >= 1),
  max_bulk_units integer check (max_bulk_units is null or max_bulk_units >= min_bulk_units),
  updated_at timestamptz not null default now(),
  unique (cycle_id, supplier_id, product_id)
);

-- Result of the per-building minimum check at cutoff.
create table public.building_cycle_status (
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  building_id uuid not null references public.buildings (id) on delete cascade,
  households integer not null,
  order_value numeric(14, 2) not null,
  met_minimum boolean not null,
  evaluated_at timestamptz not null default now(),
  primary key (cycle_id, building_id)
);

-- ---------------------------------------------------------------------------
-- Baskets
-- ---------------------------------------------------------------------------
create table public.baskets (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  building_id uuid not null references public.buildings (id),
  status public.basket_status not null default 'draft',
  payment_status public.basket_payment_status not null default 'unpaid',
  placed_by uuid references public.profiles (id), -- ambassador ordering on behalf of a resident
  upfront_required boolean not null default false,
  total numeric(14, 2) not null default 0,         -- server-computed
  retail_total numeric(14, 2) not null default 0,  -- server-computed benchmark
  deposit_due numeric(14, 2) not null default 0,   -- server-computed
  amount_paid numeric(14, 2) not null default 0,   -- server-computed from verified payments
  balance_due numeric(14, 2) generated always as (greatest(total - amount_paid, 0)) stored,
  placed_at timestamptz,
  confirmed_at timestamptz,
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, user_id)
);
create index baskets_building_idx on public.baskets (building_id, cycle_id);

create table public.basket_items (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty between 1 and 50),
  unit_price numeric(12, 2) not null default 0,   -- locked offer price, set by trigger
  retail_price numeric(12, 2) not null default 0, -- benchmark at time of order, set by trigger
  created_at timestamptz not null default now(),
  unique (basket_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Payments & credits
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  kind public.payment_kind not null,
  method public.payment_method not null,
  amount numeric(14, 2) not null check (amount > 0),
  state public.payment_state not null default 'pending',
  provider_ref text unique,                        -- gateway reference (Raast/wallet)
  receipt_no text unique,                          -- printed receipt for cash collections
  collected_by uuid references public.profiles (id), -- agent who took cash
  refund_of uuid references public.payments (id),
  deposited_at timestamptz,                        -- agent cash handed to bank (reconciliation)
  deposited_by uuid references public.profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_basket_idx on public.payments (basket_id);
create index payments_agent_idx on public.payments (collected_by) where method = 'cash_agent';

-- Store credit: + refunds of damaged goods, - credit spent on deposits/balances.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(14, 2) not null check (amount <> 0),
  reason text not null,
  payment_id uuid references public.payments (id),
  dispute_id uuid,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger (user_id);

-- ---------------------------------------------------------------------------
-- Aggregation & procurement
-- ---------------------------------------------------------------------------
create table public.demand_lots (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  product_id uuid not null references public.products (id),
  total_household_units integer not null check (total_household_units >= 0),
  bulk_units integer not null check (bulk_units >= 0),
  leftover_units integer not null default 0 check (leftover_units >= 0),
  quote_id uuid references public.supplier_quotes (id) on delete set null, -- selected rate card
  revenue numeric(14, 2) not null default 0, -- sum of offer price x units sold
  created_at timestamptz not null default now(),
  unique (cycle_id, product_id)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  status public.po_status not null default 'pending',
  subtotal numeric(14, 2) not null default 0,
  accepted_at timestamptz,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, supplier_id)
);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  lot_id uuid not null references public.demand_lots (id) on delete cascade,
  bulk_qty integer not null check (bulk_qty > 0),
  unit_price_bulk numeric(12, 2) not null
);

-- One consolidated drop-off per supplier per building.
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  building_id uuid not null references public.buildings (id),
  delivered_at timestamptz,
  received_by uuid references public.profiles (id),
  notes text,
  unique (po_id, building_id)
);

-- Pickup one-time code (hashed). The plain code is shown only to the household.
create table public.handovers (
  basket_id uuid primary key references public.baskets (id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  handed_at timestamptz,
  handed_by uuid references public.profiles (id)
);

-- ---------------------------------------------------------------------------
-- Returns (damaged / expired only)
-- ---------------------------------------------------------------------------
create table public.return_batches (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  status public.return_batch_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (building_id, cycle_id)
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  raised_by uuid not null references public.profiles (id),
  basket_item_id uuid not null references public.basket_items (id) on delete cascade,
  type public.dispute_type not null,
  qty integer not null check (qty >= 1),
  claim_amount numeric(12, 2) not null check (claim_amount > 0),
  photo_path text not null check (length(photo_path) > 0), -- photo evidence is mandatory
  note text,
  route public.dispute_route not null,
  status public.dispute_status not null default 'open',
  batch_id uuid references public.return_batches (id),
  resolution text,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.credit_ledger
  add constraint credit_ledger_dispute_fk foreign key (dispute_id) references public.disputes (id);

-- ---------------------------------------------------------------------------
-- Notifications & audit
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.cycle_events (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  from_status public.cycle_status,
  to_status public.cycle_status not null,
  actor uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index cycle_events_cycle_idx on public.cycle_events (cycle_id, created_at);

-- Allowed state-machine edges. Edges with a `via_rpc` have side effects and can only be taken
-- through that function (e.g. open -> locked only via run_cutoff).
create table public.cycle_transitions (
  from_status public.cycle_status not null,
  to_status public.cycle_status not null,
  via_rpc text,
  primary key (from_status, to_status)
);
insert into public.cycle_transitions (from_status, to_status, via_rpc) values
  ('draft', 'open', null),
  ('open', 'locked', 'run_cutoff'),
  ('locked', 'ordered', 'issue_purchase_orders'),
  ('ordered', 'dispatched', null),
  ('dispatched', 'delivered', null),
  ('delivered', 'distributing', 'start_distribution'),
  ('distributing', 'closed', 'close_cycle'),
  ('draft', 'cancelled', 'cancel_cycle'),
  ('open', 'cancelled', 'cancel_cycle'),
  ('locked', 'cancelled', 'cancel_cycle');
