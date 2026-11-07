-- BulkBasket core schema
-- Community grocery group-buying: residents pool monthly baskets per building/cluster,
-- suppliers bid on aggregated demand lots.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('resident', 'supplier', 'admin');
create type public.member_role as enum ('resident', 'captain');
create type public.member_status as enum ('pending', 'approved', 'rejected');
create type public.cycle_status as enum (
  'draft', 'open', 'locked', 'bidding', 'awarded', 'confirming',
  'ordered', 'dispatched', 'delivered', 'distributing', 'closed', 'cancelled'
);
create type public.basket_status as enum ('draft', 'submitted', 'confirmed', 'declined');
create type public.substitution_pref as enum ('same_brand', 'any_equivalent', 'skip');
-- Payments are out of scope for now; this is a placeholder (cash on delivery by default).
create type public.payment_status as enum ('unpaid', 'cod', 'paid');
create type public.bid_status as enum ('submitted', 'withdrawn', 'won', 'lost');
create type public.po_status as enum ('pending', 'accepted', 'dispatched', 'delivered', 'cancelled');
create type public.dispute_type as enum ('damaged', 'short', 'wrong_item', 'quality', 'other');
create type public.dispute_status as enum ('open', 'resolved', 'rejected');

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
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Buildings & clusters
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
  proof_path text, -- optional CNIC / utility bill photo (private storage)
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
-- Catalog
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
  image_url text,
  -- What a household orders, e.g. "5 kg bag"
  household_unit_label text not null,
  -- What a supplier sells, e.g. "50 kg sack"; split_factor household units per bulk unit
  bulk_unit_label text not null,
  split_factor integer not null check (split_factor >= 1),
  -- Benchmark retail price per household unit; used to prove savings
  reference_retail_price numeric(12, 2) not null check (reference_retail_price > 0),
  gst_rate numeric(5, 2) not null default 0 check (gst_rate >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);

-- Estimated price per household unit once cluster demand reaches min_bulk_units.
-- These are estimates shown before bidding; the final price comes from the winning bid.
create table public.price_tiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  min_bulk_units integer not null check (min_bulk_units >= 0),
  est_unit_price numeric(12, 2) not null check (est_unit_price > 0),
  unique (product_id, min_bulk_units)
);

-- ---------------------------------------------------------------------------
-- Buying cycles & baskets
-- ---------------------------------------------------------------------------
create table public.buying_cycles (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references public.clusters (id),
  name text not null,
  open_at timestamptz not null,
  cutoff_at timestamptz not null,
  bid_deadline timestamptz not null,
  confirm_deadline timestamptz not null,
  delivery_date date not null,
  status public.cycle_status not null default 'draft',
  service_fee_pct numeric(5, 2) not null default 2.5 check (service_fee_pct between 0 and 20),
  created_at timestamptz not null default now(),
  check (open_at < cutoff_at and cutoff_at < bid_deadline and bid_deadline < confirm_deadline)
);
create index buying_cycles_cluster_idx on public.buying_cycles (cluster_id, status);

create table public.baskets (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  building_id uuid not null references public.buildings (id),
  status public.basket_status not null default 'draft',
  payment_status public.payment_status not null default 'cod',
  placed_by uuid references public.profiles (id), -- captain ordering on behalf of a resident
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, user_id)
);
create index baskets_building_idx on public.baskets (building_id, cycle_id);

create table public.basket_items (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty integer not null check (qty between 1 and 100),
  est_unit_price numeric(12, 2),             -- set by trigger, never by the client
  max_unit_price numeric(12, 2) check (max_unit_price is null or max_unit_price > 0),
  substitution_pref public.substitution_pref not null default 'any_equivalent',
  final_unit_price numeric(12, 2),           -- set after award, admin/service only
  fulfilled_qty integer check (fulfilled_qty is null or fulfilled_qty >= 0),
  created_at timestamptz not null default now(),
  unique (basket_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Aggregation, bidding, purchase orders
-- ---------------------------------------------------------------------------
create table public.demand_lots (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  product_id uuid not null references public.products (id),
  total_household_units integer not null check (total_household_units >= 0),
  bulk_units integer not null check (bulk_units >= 0),
  leftover_units integer not null default 0 check (leftover_units >= 0),
  awarded_bid_id uuid,
  created_at timestamptz not null default now(),
  unique (cycle_id, product_id)
);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.demand_lots (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  unit_price_bulk numeric(12, 2) not null check (unit_price_bulk > 0),
  available_bulk_units integer not null check (available_bulk_units > 0),
  delivery_date date not null,
  notes text,
  status public.bid_status not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lot_id, supplier_id)
);
alter table public.demand_lots
  add constraint demand_lots_awarded_bid_fk
  foreign key (awarded_bid_id) references public.bids (id) on delete set null;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  status public.po_status not null default 'pending',
  invoice_path text,
  subtotal numeric(14, 2) not null default 0,
  gst_total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (cycle_id, supplier_id)
);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  lot_id uuid not null references public.demand_lots (id),
  bulk_qty integer not null check (bulk_qty > 0),
  unit_price_bulk numeric(12, 2) not null,
  received_qty integer check (received_qty is null or received_qty >= 0),
  damaged_qty integer check (damaged_qty is null or damaged_qty >= 0)
);

-- ---------------------------------------------------------------------------
-- Fulfilment & trust
-- ---------------------------------------------------------------------------
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  building_id uuid not null references public.buildings (id),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  received_by uuid references public.profiles (id),
  photos text[] not null default '{}',
  notes text,
  unique (po_id, building_id)
);

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null unique references public.baskets (id) on delete cascade,
  otp_hash text not null,
  handed_at timestamptz,
  handed_by uuid references public.profiles (id)
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  raised_by uuid not null references public.profiles (id),
  basket_item_id uuid references public.basket_items (id) on delete cascade,
  po_line_id uuid references public.po_lines (id) on delete cascade,
  type public.dispute_type not null,
  description text not null,
  photos text[] not null default '{}',
  status public.dispute_status not null default 'open',
  resolution text,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (basket_item_id is not null or po_line_id is not null)
);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  cycle_id uuid not null references public.buying_cycles (id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (from_user, supplier_id, cycle_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}',
  channel text not null default 'in_app',
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

-- Allowed state-machine edges for buying cycles.
create table public.cycle_transitions (
  from_status public.cycle_status not null,
  to_status public.cycle_status not null,
  primary key (from_status, to_status)
);
insert into public.cycle_transitions (from_status, to_status) values
  ('draft', 'open'),
  ('open', 'locked'),
  ('locked', 'bidding'),
  ('bidding', 'awarded'),
  ('awarded', 'confirming'),
  ('confirming', 'ordered'),
  ('ordered', 'dispatched'),
  ('dispatched', 'delivered'),
  ('delivered', 'distributing'),
  ('distributing', 'closed'),
  ('draft', 'cancelled'), ('open', 'cancelled'), ('locked', 'cancelled'),
  ('bidding', 'cancelled'), ('awarded', 'cancelled'), ('confirming', 'cancelled');
