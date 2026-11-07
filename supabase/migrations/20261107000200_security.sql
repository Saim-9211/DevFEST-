-- BulkBasket security layer: helper functions, guard triggers, RPCs and RLS policies.
-- Principle: the client may only write what it owns; prices, statuses and verification
-- flags are set by triggers / security-definer functions, never trusted from the client.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- For security-definer RPCs: the caller is an admin user or the service-role key.
create or replace function public.is_admin_or_service()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

-- SECURITY INVOKER on purpose: inside a security-definer RPC current_user is the owner,
-- which correctly counts as privileged; a client connection is 'authenticated' or 'anon'.
create or replace function public.is_privileged()
returns boolean language sql stable set search_path = ''
as $$
  select current_user::text not in ('authenticated', 'anon') or public.is_admin();
$$;

create or replace function public.is_member_of(p_building uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.building_members
    where building_id = p_building and user_id = p_user and status = 'approved'
  );
$$;

create or replace function public.is_captain_of(p_building uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.building_members
    where building_id = p_building and user_id = auth.uid()
      and status = 'approved' and member_role = 'captain'
  );
$$;

-- True when the caller is the captain of any building that `p_user` belongs to.
create or replace function public.is_captain_of_user(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.building_members target
    join public.building_members me
      on me.building_id = target.building_id
     and me.user_id = auth.uid() and me.status = 'approved' and me.member_role = 'captain'
    where target.user_id = p_user
  );
$$;

create or replace function public.my_supplier_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select supplier_id from public.supplier_users where user_id = auth.uid();
$$;

create or replace function public.my_verified_supplier_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select su.supplier_id
  from public.supplier_users su
  join public.suppliers s on s.id = su.supplier_id and s.verified
  where su.user_id = auth.uid();
$$;

-- Residents may only edit baskets while the cycle is open and before cutoff.
create or replace function public.cycle_is_open(p_cycle uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.buying_cycles
    where id = p_cycle and status = 'open' and now() < cutoff_at
  );
$$;

-- Who may create/edit a basket: the household itself, or its building captain on its behalf.
create or replace function public.can_write_basket(p_cycle uuid, p_building uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_member_of(p_building, p_user)
     and exists (
       select 1 from public.buying_cycles c
       join public.buildings b on b.cluster_id = c.cluster_id
       where c.id = p_cycle and b.id = p_building
     )
     and (p_user = auth.uid() or public.is_captain_of(p_building));
$$;

create or replace function public.can_edit_basket(p_basket uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.baskets b
    where b.id = p_basket
      and public.cycle_is_open(b.cycle_id)
      and public.can_write_basket(b.cycle_id, b.building_id, b.user_id)
  );
$$;

create or replace function public.can_view_basket(p_basket uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.baskets b
    where b.id = p_basket
      and (b.user_id = auth.uid() or public.is_captain_of(b.building_id) or public.is_admin())
  );
$$;

-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------
-- Estimated price per household unit for a given cluster demand (in bulk units).
-- Falls back to the reference retail price when no tier applies.
create or replace function public.estimate_unit_price(p_product uuid, p_bulk_units integer)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select est_unit_price from public.price_tiers
      where product_id = p_product and min_bulk_units <= greatest(p_bulk_units, 0)
      order by min_bulk_units desc limit 1),
    (select reference_retail_price from public.products where id = p_product)
  );
$$;

-- Live household units of a product ordered across the whole cycle (all buildings in the cluster).
create or replace function public.cycle_product_units(p_cycle uuid, p_product uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(bi.qty), 0)::integer
  from public.basket_items bi
  join public.baskets b on b.id = bi.basket_id
  where b.cycle_id = p_cycle and bi.product_id = p_product
    and b.status in ('draft', 'submitted', 'confirmed');
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile. Role is ALWAYS 'resident'; metadata can't escalate it.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
    case when new.raw_user_meta_data ->> 'locale' = 'ur' then 'ur' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------
-- Suppliers can edit their profile but never their own verification or rating.
create or replace function public.guard_supplier()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not public.is_privileged() then
    new.verified := old.verified;
    new.rating := old.rating;
  end if;
  return new;
end;
$$;
create trigger guard_supplier before update on public.suppliers
  for each row execute function public.guard_supplier();

-- Baskets: identity columns are immutable; status moves are limited by cycle phase.
create or replace function public.guard_basket()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_cycle_status public.cycle_status;
begin
  if public.is_privileged() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.payment_status := 'cod';
    new.submitted_at := null;
    new.confirmed_at := null;
    new.placed_by := case when new.user_id = auth.uid() then null else auth.uid() end;
    return new;
  end if;

  if new.user_id <> old.user_id or new.cycle_id <> old.cycle_id
     or new.building_id <> old.building_id
     or new.payment_status <> old.payment_status
     or new.placed_by is distinct from old.placed_by then
    raise exception 'basket identity and payment fields are read-only';
  end if;

  if new.status <> old.status then
    select status into v_cycle_status from public.buying_cycles where id = new.cycle_id;
    if v_cycle_status = 'open' and new.status in ('draft', 'submitted')
       and old.status in ('draft', 'submitted') then
      new.submitted_at := case when new.status = 'submitted' then now() else null end;
    elsif v_cycle_status = 'confirming' and old.status = 'submitted'
          and new.status in ('confirmed', 'declined') and new.user_id = auth.uid() then
      new.confirmed_at := now();
    else
      raise exception 'basket status change % -> % not allowed while cycle is %',
        old.status, new.status, v_cycle_status;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_basket before insert or update on public.baskets
  for each row execute function public.guard_basket();

-- Basket items: estimated price is computed server-side; final price/fulfilment are admin-only.
create or replace function public.price_basket_item()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_cycle uuid;
  v_split integer;
  v_units integer;
begin
  select b.cycle_id into v_cycle from public.baskets b where b.id = new.basket_id;
  select split_factor into v_split from public.products where id = new.product_id;

  v_units := public.cycle_product_units(v_cycle, new.product_id)
           - case when tg_op = 'UPDATE' then old.qty else 0 end
           + new.qty;
  new.est_unit_price := public.estimate_unit_price(
    new.product_id, ceil(v_units::numeric / v_split)::integer
  );

  if not public.is_privileged() then
    if tg_op = 'INSERT' then
      new.final_unit_price := null;
      new.fulfilled_qty := null;
    else
      new.final_unit_price := old.final_unit_price;
      new.fulfilled_qty := old.fulfilled_qty;
      if new.basket_id <> old.basket_id or new.product_id <> old.product_id then
        raise exception 'basket item identity is read-only';
      end if;
    end if;
    -- Default the max acceptable price to the estimate plus 10% headroom.
    if new.max_unit_price is null then
      new.max_unit_price := round(new.est_unit_price * 1.10, 2);
    end if;
  end if;
  return new;
end;
$$;
create trigger price_basket_item before insert or update on public.basket_items
  for each row execute function public.price_basket_item();

-- Bids: only while the cycle is in bidding and before the deadline; suppliers can't mark wins.
create or replace function public.guard_bid()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_ok boolean;
begin
  new.updated_at := now();
  if public.is_privileged() then
    return new;
  end if;

  select exists (
    select 1 from public.demand_lots l
    join public.buying_cycles c on c.id = l.cycle_id
    where l.id = new.lot_id and c.status = 'bidding' and now() <= c.bid_deadline
  ) into v_ok;
  if not v_ok then
    raise exception 'bidding is closed for this lot';
  end if;

  if new.status not in ('submitted', 'withdrawn') then
    raise exception 'suppliers may only submit or withdraw bids';
  end if;
  if tg_op = 'UPDATE' and (new.lot_id <> old.lot_id or new.supplier_id <> old.supplier_id) then
    raise exception 'bid identity is read-only';
  end if;
  return new;
end;
$$;
create trigger guard_bid before insert or update on public.bids
  for each row execute function public.guard_bid();

-- ---------------------------------------------------------------------------
-- RPCs (called from server actions)
-- ---------------------------------------------------------------------------
-- Join a building with an invite code (from the captain). Creates a pending membership.
create or replace function public.join_building_by_code(p_code text, p_flat_no text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select building_id into v_building from public.building_invites
   where code = upper(trim(p_code));
  if v_building is null then raise exception 'invalid invite code'; end if;

  insert into public.building_members (building_id, user_id, flat_no)
  values (v_building, auth.uid(), trim(p_flat_no))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'you already joined this building, or flat % is already registered', p_flat_no;
end;
$$;

-- Request to join a building found by search (no code). Also pending until a captain approves.
create or replace function public.request_join_building(p_building uuid, p_flat_no text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.building_members (building_id, user_id, flat_no)
  values (p_building, auth.uid(), trim(p_flat_no))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'you already joined this building, or flat % is already registered', p_flat_no;
end;
$$;

-- Captain (or admin) approves / rejects a pending member.
create or replace function public.review_membership(p_member uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid;
begin
  select building_id into v_building from public.building_members where id = p_member;
  if v_building is null then raise exception 'membership not found'; end if;
  if not (public.is_captain_of(v_building) or public.is_admin()) then
    raise exception 'only the building captain can review members';
  end if;

  update public.building_members
     set status = case when p_approve then 'approved'::public.member_status
                       else 'rejected'::public.member_status end,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_member and status = 'pending';
end;
$$;

-- Captain (or admin) reads the building's invite code.
create or replace function public.get_building_invite(p_building uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not (public.is_captain_of(p_building) or public.is_admin()) then
    raise exception 'only the building captain can view the invite code';
  end if;
  insert into public.building_invites (building_id) values (p_building)
  on conflict (building_id) do nothing;
  select code into v_code from public.building_invites where building_id = p_building;
  return v_code;
end;
$$;

-- Supplier self-registration. Creates an unverified supplier and links the caller to it.
create or replace function public.register_supplier(
  p_business_name text, p_city text, p_contact_phone text,
  p_ntn text default null, p_strn text default null, p_address text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_role public.app_role;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role = 'admin' then raise exception 'admins cannot register as suppliers'; end if;
  if exists (select 1 from public.building_members where user_id = auth.uid()) then
    raise exception 'this account is a building resident; use a separate account for your business';
  end if;
  if exists (select 1 from public.supplier_users where user_id = auth.uid()) then
    raise exception 'this account is already linked to a supplier';
  end if;

  insert into public.suppliers (business_name, city, contact_phone, ntn, strn, address, service_cities)
  values (trim(p_business_name), trim(p_city), p_contact_phone, p_ntn, p_strn, p_address, array[trim(p_city)])
  returning id into v_id;
  insert into public.supplier_users (supplier_id, user_id) values (v_id, auth.uid());
  update public.profiles set role = 'supplier' where id = auth.uid();
  return v_id;
end;
$$;

-- Admin moves a cycle along the state machine; every move is audited.
create or replace function public.transition_cycle(
  p_cycle uuid, p_to public.cycle_status, p_note text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_from public.cycle_status;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  select status into v_from from public.buying_cycles where id = p_cycle for update;
  if v_from is null then raise exception 'cycle not found'; end if;
  if not exists (
    select 1 from public.cycle_transitions where from_status = v_from and to_status = p_to
  ) then
    raise exception 'illegal transition % -> %', v_from, p_to;
  end if;

  update public.buying_cycles set status = p_to where id = p_cycle;
  insert into public.cycle_events (cycle_id, from_status, to_status, actor, note)
  values (p_cycle, v_from, p_to, auth.uid(), p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- Profiles: users may edit only these columns; role/reliability are server-controlled.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, phone, locale) on public.profiles to authenticated;

-- Membership rows are created/changed through RPCs only.
revoke insert, update, delete on public.building_members from anon, authenticated;
revoke all on public.building_invites from anon, authenticated;
revoke all on public.cycle_transitions from anon;
revoke insert, update, delete on public.cycle_events from anon, authenticated;
revoke insert, update, delete on public.notifications from anon;
revoke insert, delete on public.notifications from authenticated;

revoke execute on function public.transition_cycle(uuid, public.cycle_status, text) from anon;
revoke execute on function public.register_supplier(text, text, text, text, text, text) from anon;
revoke execute on function public.join_building_by_code(text, text) from anon;
revoke execute on function public.request_join_building(uuid, text) from anon;
revoke execute on function public.review_membership(uuid, boolean) from anon;
revoke execute on function public.get_building_invite(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clusters enable row level security;
alter table public.buildings enable row level security;
alter table public.building_invites enable row level security;
alter table public.building_members enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.price_tiers enable row level security;
alter table public.buying_cycles enable row level security;
alter table public.baskets enable row level security;
alter table public.basket_items enable row level security;
alter table public.demand_lots enable row level security;
alter table public.bids enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_lines enable row level security;
alter table public.deliveries enable row level security;
alter table public.handovers enable row level security;
alter table public.disputes enable row level security;
alter table public.ratings enable row level security;
alter table public.notifications enable row level security;
alter table public.cycle_events enable row level security;
alter table public.cycle_transitions enable row level security;

-- Profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.is_captain_of_user(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Public reference data: catalog, clusters, buildings, cycles, transitions
create policy clusters_read on public.clusters for select to anon, authenticated using (true);
create policy clusters_admin on public.clusters for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy buildings_read on public.buildings for select to authenticated using (true);
create policy buildings_admin on public.buildings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy categories_admin on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy products_read on public.products for select to anon, authenticated
  using (active or public.is_admin());
create policy products_admin on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy price_tiers_read on public.price_tiers for select to anon, authenticated using (true);
create policy price_tiers_admin on public.price_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy cycles_read on public.buying_cycles for select to authenticated using (true);
create policy cycles_admin on public.buying_cycles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy cycle_transitions_read on public.cycle_transitions for select to authenticated using (true);

create policy cycle_events_read on public.cycle_events for select to authenticated using (true);

-- Building invites: captain/admin only (normally read via get_building_invite)
create policy building_invites_captain on public.building_invites for select to authenticated
  using (public.is_captain_of(building_id) or public.is_admin());

-- Building members
create policy members_select on public.building_members for select to authenticated
  using (user_id = auth.uid() or public.is_captain_of(building_id) or public.is_admin());

-- Suppliers: verified suppliers are visible (name/rating); own supplier and admin see all
create policy suppliers_select on public.suppliers for select to authenticated
  using (verified or id in (select public.my_supplier_ids()) or public.is_admin());
create policy suppliers_update_own on public.suppliers for update to authenticated
  using (id in (select public.my_supplier_ids()))
  with check (id in (select public.my_supplier_ids()));
create policy suppliers_admin on public.suppliers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy supplier_users_select on public.supplier_users for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy supplier_users_admin on public.supplier_users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Baskets
create policy baskets_select on public.baskets for select to authenticated
  using (user_id = auth.uid() or public.is_captain_of(building_id) or public.is_admin());
create policy baskets_insert on public.baskets for insert to authenticated
  with check (public.cycle_is_open(cycle_id) and public.can_write_basket(cycle_id, building_id, user_id));
create policy baskets_update on public.baskets for update to authenticated
  using (user_id = auth.uid() or public.is_captain_of(building_id))
  with check (public.can_write_basket(cycle_id, building_id, user_id));
create policy baskets_delete on public.baskets for delete to authenticated
  using (status = 'draft' and public.cycle_is_open(cycle_id)
         and public.can_write_basket(cycle_id, building_id, user_id));
create policy baskets_admin on public.baskets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Basket items
create policy basket_items_select on public.basket_items for select to authenticated
  using (public.can_view_basket(basket_id));
create policy basket_items_insert on public.basket_items for insert to authenticated
  with check (public.can_edit_basket(basket_id));
create policy basket_items_update on public.basket_items for update to authenticated
  using (public.can_edit_basket(basket_id)) with check (public.can_edit_basket(basket_id));
create policy basket_items_delete on public.basket_items for delete to authenticated
  using (public.can_edit_basket(basket_id));
create policy basket_items_admin on public.basket_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Demand lots: aggregated & anonymous; visible to verified suppliers and admins
create policy lots_select on public.demand_lots for select to authenticated
  using (public.is_admin() or exists (select 1 from public.my_verified_supplier_ids()));
create policy lots_admin on public.demand_lots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Bids: a supplier sees and edits only its own bids
create policy bids_select on public.bids for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()) or public.is_admin());
create policy bids_insert on public.bids for insert to authenticated
  with check (supplier_id in (select public.my_verified_supplier_ids()));
create policy bids_update on public.bids for update to authenticated
  using (supplier_id in (select public.my_verified_supplier_ids()))
  with check (supplier_id in (select public.my_verified_supplier_ids()));
create policy bids_admin on public.bids for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Purchase orders & lines
create policy po_select on public.purchase_orders for select to authenticated
  using (
    supplier_id in (select public.my_supplier_ids()) or public.is_admin()
    or exists (select 1 from public.deliveries d
               where d.po_id = purchase_orders.id and public.is_captain_of(d.building_id))
  );
create policy po_supplier_update on public.purchase_orders for update to authenticated
  using (supplier_id in (select public.my_supplier_ids()))
  with check (supplier_id in (select public.my_supplier_ids()));
create policy po_admin on public.purchase_orders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy po_lines_select on public.po_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = po_lines.po_id));
create policy po_lines_admin on public.po_lines for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Deliveries
create policy deliveries_select on public.deliveries for select to authenticated
  using (
    public.is_captain_of(building_id) or public.is_admin()
    or exists (select 1 from public.purchase_orders po
               where po.id = deliveries.po_id and po.supplier_id in (select public.my_supplier_ids()))
  );
create policy deliveries_captain_update on public.deliveries for update to authenticated
  using (public.is_captain_of(building_id)) with check (public.is_captain_of(building_id));
create policy deliveries_admin on public.deliveries for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Handovers (OTP is stored hashed; verification happens in an RPC in phase 4)
create policy handovers_select on public.handovers for select to authenticated
  using (public.can_view_basket(basket_id));
create policy handovers_admin on public.handovers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Disputes
create policy disputes_select on public.disputes for select to authenticated
  using (
    raised_by = auth.uid() or public.is_admin()
    or exists (select 1 from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
               where pl.id = disputes.po_line_id and po.supplier_id in (select public.my_supplier_ids()))
  );
create policy disputes_insert on public.disputes for insert to authenticated
  with check (
    raised_by = auth.uid() and status = 'open'
    and (
      (basket_item_id is not null and exists (
        select 1 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
        where bi.id = disputes.basket_item_id and b.user_id = auth.uid()))
      or
      (po_line_id is not null and exists (
        select 1 from public.po_lines pl join public.deliveries d on d.po_id = pl.po_id
        where pl.id = disputes.po_line_id and public.is_captain_of(d.building_id)))
    )
  );
create policy disputes_admin on public.disputes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Ratings: anyone signed in can read; residents rate suppliers of cycles they ordered in
create policy ratings_read on public.ratings for select to authenticated using (true);
create policy ratings_insert on public.ratings for insert to authenticated
  with check (
    from_user = auth.uid()
    and exists (select 1 from public.baskets b
                where b.user_id = auth.uid() and b.cycle_id = ratings.cycle_id
                  and b.status = 'confirmed')
  );

-- Notifications: users read their own and may mark them read
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
