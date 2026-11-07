-- CollectiveCart security & business rules: helpers, triggers, RPCs, RLS.
-- Principle: clients write only what they own. Prices, totals, deposits, payment state,
-- basket status and verification flags are computed by triggers / security-definer RPCs.

-- ===========================================================================
-- Helpers
-- ===========================================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;

create or replace function public.is_service()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role'; $$;

create or replace function public.is_admin_or_service()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.is_admin() or public.is_service(); $$;

-- SECURITY INVOKER on purpose: inside security-definer code current_user is the owner (privileged);
-- a client connection runs as 'authenticated' or 'anon'.
create or replace function public.is_privileged()
returns boolean language sql stable set search_path = ''
as $$ select current_user::text not in ('authenticated', 'anon') or public.is_admin(); $$;

create or replace function public.is_member_of(p_building uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.building_members
                 where building_id = p_building and user_id = p_user and status = 'approved');
$$;

create or replace function public.is_ambassador_of(p_building uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.building_members
                 where building_id = p_building and user_id = auth.uid()
                   and status = 'approved' and member_role = 'ambassador');
$$;

-- True when the caller is the ambassador of any building that `p_user` belongs to.
create or replace function public.is_ambassador_of_user(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.building_members target
    join public.building_members me
      on me.building_id = target.building_id and me.user_id = auth.uid()
     and me.status = 'approved' and me.member_role = 'ambassador'
    where target.user_id = p_user);
$$;

create or replace function public.is_agent_for(p_building uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.agent_buildings ab
                 join public.profiles p on p.id = ab.agent_id and p.role = 'agent'
                 where ab.agent_id = auth.uid() and ab.building_id = p_building);
$$;

create or replace function public.my_supplier_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$ select supplier_id from public.supplier_users where user_id = auth.uid(); $$;

create or replace function public.my_verified_supplier_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select su.supplier_id from public.supplier_users su
  join public.suppliers s on s.id = su.supplier_id and s.verified
  where su.user_id = auth.uid();
$$;

create or replace function public.cycle_is_open(p_cycle uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.buying_cycles
                 where id = p_cycle and status = 'open' and now() < cutoff_at);
$$;

-- Household itself, or its building ambassador ordering on its behalf.
create or replace function public.can_write_basket(p_cycle uuid, p_building uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_member_of(p_building, p_user)
     and exists (select 1 from public.buying_cycles c
                 join public.buildings b on b.cluster_id = c.cluster_id
                 where c.id = p_cycle and b.id = p_building)
     and (p_user = auth.uid() or public.is_ambassador_of(p_building));
$$;

-- Items can change only before the deposit is paid and while the cycle is open.
create or replace function public.basket_editable(p_basket uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.baskets b
                 where b.id = p_basket and b.status in ('draft', 'pending_deposit')
                   and public.cycle_is_open(b.cycle_id)
                   and public.can_write_basket(b.cycle_id, b.building_id, b.user_id));
$$;

create or replace function public.can_view_basket(p_basket uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.baskets b
                 where b.id = p_basket
                   and (b.user_id = auth.uid() or public.is_ambassador_of(b.building_id)
                        or public.is_agent_for(b.building_id) or public.is_admin()));
$$;

-- Policy helpers that read across purchase_orders/deliveries without recursive RLS.
create or replace function public.is_my_po(p_po uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.purchase_orders
                 where id = p_po and supplier_id in (select public.my_supplier_ids()));
$$;

create or replace function public.is_building_staff_for_po(p_po uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.deliveries d
                 where d.po_id = p_po and (public.is_ambassador_of(d.building_id) or public.is_agent_for(d.building_id)));
$$;

create or replace function public.credit_balance(p_user uuid default auth.uid())
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.credit_ledger
  where user_id = p_user and (p_user = auth.uid() or public.is_admin_or_service());
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients; see revokes below)
-- ---------------------------------------------------------------------------
create or replace function public._notify(p_user uuid, p_type text, p_title text, p_body text, p_payload jsonb default '{}')
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, payload)
  values (p_user, p_type, p_title, p_body, p_payload);
$$;

create or replace function public._move_cycle(p_cycle uuid, p_to public.cycle_status, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_from public.cycle_status;
begin
  select status into v_from from public.buying_cycles where id = p_cycle for update;
  if v_from is null then raise exception 'cycle not found'; end if;
  if not exists (select 1 from public.cycle_transitions where from_status = v_from and to_status = p_to) then
    raise exception 'illegal transition % -> %', v_from, p_to;
  end if;
  update public.buying_cycles set status = p_to where id = p_cycle;
  insert into public.cycle_events (cycle_id, from_status, to_status, actor, note)
  values (p_cycle, v_from, p_to, auth.uid(), p_note);
end;
$$;

create or replace function public._recalc_basket(p_basket uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_total numeric; v_retail numeric;
begin
  select coalesce(sum(qty * unit_price), 0), coalesce(sum(qty * retail_price), 0)
    into v_total, v_retail from public.basket_items where basket_id = p_basket;
  update public.baskets b
     set total = v_total,
         retail_total = v_retail,
         deposit_due = case when b.upfront_required then v_total
                            else ceil(v_total * c.deposit_pct / 100) end
    from public.buying_cycles c
   where b.id = p_basket and c.id = b.cycle_id;
end;
$$;

-- Apply a just-verified (non-refund) payment to its basket.
create or replace function public._apply_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_p public.payments; v_b public.baskets;
begin
  select * into v_p from public.payments where id = p_payment;
  update public.baskets set amount_paid = amount_paid + v_p.amount where id = v_p.basket_id
  returning * into v_b;

  if v_b.status = 'pending_deposit' and v_b.amount_paid >= v_b.deposit_due then
    update public.baskets
       set status = 'confirmed', confirmed_at = now(),
           payment_status = case when amount_paid >= total then 'paid_in_full'::public.basket_payment_status
                                 else 'deposit_paid'::public.basket_payment_status end
     where id = v_b.id;
    perform public._notify(v_b.user_id, 'order_confirmed', 'Order confirmed',
      format('Deposit received (Rs %s). Your order is in this month''s building order.', v_p.amount),
      jsonb_build_object('basket_id', v_b.id));
  elsif v_b.status in ('confirmed', 'ready') and v_b.amount_paid >= v_b.total then
    update public.baskets set payment_status = 'paid_in_full' where id = v_b.id;
    perform public._notify(v_b.user_id, 'paid_in_full', 'Balance paid',
      format('Payment of Rs %s received. Show your pickup code to collect.', v_p.amount),
      jsonb_build_object('basket_id', v_b.id, 'receipt_no', v_p.receipt_no));
  end if;
end;
$$;

-- Refund everything paid on a basket and cancel it. Online/cash payments are refunded to the
-- original method (simulated as an immediate verified refund row); credit goes back to credit.
create or replace function public._refund_basket(p_basket uuid, p_reason text)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare v_p record; v_total numeric := 0; v_user uuid;
begin
  select user_id into v_user from public.baskets where id = p_basket;
  update public.payments set state = 'cancelled' where basket_id = p_basket and state = 'pending';

  for v_p in select * from public.payments
             where basket_id = p_basket and state = 'verified' and kind <> 'refund' loop
    if v_p.method = 'credit' then
      insert into public.credit_ledger (user_id, amount, reason, payment_id)
      values (v_p.user_id, v_p.amount, 'Refund: ' || p_reason, v_p.id);
    else
      insert into public.payments (basket_id, user_id, kind, method, amount, state, refund_of, verified_at, provider_ref)
      values (p_basket, v_p.user_id, 'refund', v_p.method, v_p.amount, 'verified', v_p.id, now(),
              'RF-' || upper(substr(md5(v_p.id::text || clock_timestamp()::text), 1, 10)));
    end if;
    v_total := v_total + v_p.amount;
  end loop;

  update public.baskets
     set status = 'cancelled',
         payment_status = case when v_total > 0 then 'refunded'::public.basket_payment_status else payment_status end,
         amount_paid = 0
   where id = p_basket;

  if v_total > 0 then
    perform public._notify(v_user, 'refunded', 'Order cancelled and refunded',
      format('%s. Rs %s has been refunded.', p_reason, v_total), jsonb_build_object('basket_id', p_basket));
  else
    perform public._notify(v_user, 'cancelled', 'Order cancelled', p_reason, jsonb_build_object('basket_id', p_basket));
  end if;
  return v_total;
end;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================
-- New auth user -> profile. Role is ALWAYS 'resident'; metadata can't escalate it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, locale)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
          case when new.raw_user_meta_data ->> 'locale' = 'ur' then 'ur' else 'en' end)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Suppliers can't verify themselves or set their own rating.
create or replace function public.guard_supplier()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not public.is_privileged() then new.verified := old.verified; new.rating := old.rating; end if;
  return new;
end;
$$;
create trigger guard_supplier before update on public.suppliers
  for each row execute function public.guard_supplier();

-- Baskets: clients only create drafts; every later change goes through RPCs.
create or replace function public.guard_basket()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if public.is_privileged() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.payment_status := 'unpaid';
    new.total := 0; new.retail_total := 0; new.deposit_due := 0; new.amount_paid := 0;
    new.placed_at := null; new.confirmed_at := null; new.collected_at := null;
    new.placed_by := case when new.user_id = auth.uid() then null else auth.uid() end;
    new.upfront_required := coalesce((select upfront_only from public.profiles where id = new.user_id), false);
    return new;
  end if;
  raise exception 'baskets can only be changed through the ordering and payment flow';
end;
$$;
create trigger guard_basket before insert or update on public.baskets
  for each row execute function public.guard_basket();

-- Item price is the cycle's fixed offer; retail benchmark is recorded for savings reporting.
create or replace function public.price_basket_item()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_offer numeric; v_retail numeric;
begin
  if tg_op = 'UPDATE' and (new.basket_id <> old.basket_id or new.product_id <> old.product_id) then
    raise exception 'basket item identity is read-only';
  end if;
  select o.offer_price, p.reference_retail_price into v_offer, v_retail
    from public.baskets b
    join public.cycle_offers o on o.cycle_id = b.cycle_id and o.product_id = new.product_id and o.active
    join public.products p on p.id = new.product_id and p.active
   where b.id = new.basket_id;
  if v_offer is null then raise exception 'this product is not offered in the current cycle'; end if;
  new.unit_price := v_offer;
  new.retail_price := v_retail;
  return new;
end;
$$;
create trigger price_basket_item before insert or update on public.basket_items
  for each row execute function public.price_basket_item();

create or replace function public.recalc_basket_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public._recalc_basket(coalesce(new.basket_id, old.basket_id));
  return null;
end;
$$;
create trigger recalc_basket after insert or update or delete on public.basket_items
  for each row execute function public.recalc_basket_trigger();

-- Rate cards can be edited only before cutoff.
create or replace function public.guard_quote()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if not public.is_privileged() and not exists (
    select 1 from public.buying_cycles where id = new.cycle_id and status in ('draft', 'open')) then
    raise exception 'rate cards are closed for this cycle';
  end if;
  return new;
end;
$$;
create trigger guard_quote before insert or update on public.supplier_quotes
  for each row execute function public.guard_quote();

-- Loss guard: an offer may not be priced below the cheapest verified wholesale cost.
create or replace function public.guard_offer()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_cost numeric;
begin
  select min(q.price_per_bulk / p.split_factor) into v_cost
    from public.supplier_quotes q
    join public.products p on p.id = q.product_id
    join public.suppliers s on s.id = q.supplier_id and s.verified
   where q.cycle_id = new.cycle_id and q.product_id = new.product_id;
  if v_cost is not null and new.offer_price < v_cost then
    raise exception 'offer price Rs % is below the best wholesale cost Rs %', new.offer_price, round(v_cost, 2);
  end if;
  return new;
end;
$$;
create trigger guard_offer before insert or update on public.cycle_offers
  for each row execute function public.guard_offer();

-- ===========================================================================
-- Membership & onboarding RPCs
-- ===========================================================================
create or replace function public.join_building_by_code(p_code text, p_flat_no text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_building uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select building_id into v_building from public.building_invites where code = upper(trim(p_code));
  if v_building is null then raise exception 'invalid invite code'; end if;
  insert into public.building_members (building_id, user_id, flat_no)
  values (v_building, auth.uid(), trim(p_flat_no)) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'you already joined this building, or flat % is already registered', p_flat_no;
end;
$$;

create or replace function public.request_join_building(p_building uuid, p_flat_no text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.building_members (building_id, user_id, flat_no)
  values (p_building, auth.uid(), trim(p_flat_no)) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'you already joined this building, or flat % is already registered', p_flat_no;
end;
$$;

create or replace function public.review_membership(p_member uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_building uuid; v_user uuid;
begin
  select building_id, user_id into v_building, v_user from public.building_members where id = p_member;
  if v_building is null then raise exception 'membership not found'; end if;
  if not (public.is_ambassador_of(v_building) or public.is_admin()) then
    raise exception 'only the building ambassador can review members';
  end if;
  update public.building_members
     set status = case when p_approve then 'approved'::public.member_status else 'rejected'::public.member_status end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_member and status = 'pending';
  perform public._notify(v_user, 'membership', case when p_approve then 'You''re in!' else 'Membership declined' end,
    case when p_approve then 'Your building ambassador approved your flat. You can order now.'
         else 'Your request was declined. Contact your building ambassador.' end);
end;
$$;

create or replace function public.get_building_invite(p_building uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_code text;
begin
  if not (public.is_ambassador_of(p_building) or public.is_admin()) then
    raise exception 'only the building ambassador can view the invite code';
  end if;
  insert into public.building_invites (building_id) values (p_building) on conflict (building_id) do nothing;
  select code into v_code from public.building_invites where building_id = p_building;
  return v_code;
end;
$$;

create or replace function public.register_supplier(
  p_business_name text, p_city text, p_contact_phone text,
  p_ntn text default null, p_strn text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_role public.app_role;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role in ('admin', 'agent') then raise exception 'staff accounts cannot register as suppliers'; end if;
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

-- ===========================================================================
-- Ordering & payment RPCs
-- ===========================================================================
-- Draft -> pending_deposit. The deposit (or full amount for upfront-only households) is now due.
create or replace function public.place_order(p_basket uuid)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare v_b public.baskets;
begin
  select * into v_b from public.baskets where id = p_basket for update;
  if v_b.id is null or not public.can_write_basket(v_b.cycle_id, v_b.building_id, v_b.user_id) then
    raise exception 'basket not found';
  end if;
  if not public.cycle_is_open(v_b.cycle_id) then raise exception 'ordering is closed for this cycle'; end if;
  if v_b.status <> 'draft' then raise exception 'order already placed'; end if;
  if v_b.total <= 0 then raise exception 'your basket is empty'; end if;
  update public.baskets set status = 'pending_deposit', placed_at = now() where id = p_basket;
  return v_b.deposit_due;
end;
$$;

-- What the household owes right now: the deposit while ordering, the balance at pickup.
create or replace function public._amount_due(p_basket uuid, p_kind public.payment_kind)
returns numeric language plpgsql stable security definer set search_path = ''
as $$
declare v_b public.baskets; v_cycle public.cycle_status;
begin
  select * into v_b from public.baskets where id = p_basket;
  select status into v_cycle from public.buying_cycles where id = v_b.cycle_id;
  if p_kind = 'deposit' then
    if v_b.status <> 'pending_deposit' or not public.cycle_is_open(v_b.cycle_id) then
      raise exception 'no deposit is due on this order';
    end if;
    return greatest(v_b.deposit_due - v_b.amount_paid, 0);
  elsif p_kind = 'balance' then
    if v_b.status not in ('confirmed', 'ready') or v_cycle not in ('delivered', 'distributing') then
      raise exception 'the balance is paid at pickup, once your order has been delivered';
    end if;
    return v_b.balance_due;
  end if;
  raise exception 'invalid payment kind';
end;
$$;

-- Start an online payment (Raast / JazzCash / Easypaisa). Amount is computed here, never by the client.
create or replace function public.start_payment(p_basket uuid, p_kind public.payment_kind, p_method public.payment_method)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_b public.baskets; v_amount numeric; v_id uuid;
begin
  select * into v_b from public.baskets where id = p_basket;
  if v_b.id is null or v_b.user_id <> auth.uid() then raise exception 'basket not found'; end if;
  if p_method not in ('raast', 'jazzcash', 'easypaisa') then raise exception 'unsupported online payment method'; end if;
  v_amount := public._amount_due(p_basket, p_kind);
  if v_amount <= 0 then raise exception 'nothing is due'; end if;

  update public.payments set state = 'cancelled'
   where basket_id = p_basket and kind = p_kind and state = 'pending';
  insert into public.payments (basket_id, user_id, kind, method, amount, provider_ref)
  values (p_basket, v_b.user_id, p_kind, p_method, v_amount,
          'CC-' || upper(substr(md5(gen_random_uuid()::text), 1, 12)))
  returning id into v_id;
  return v_id;
end;
$$;

-- Gateway callback (webhook). Service role only.
create or replace function public.confirm_payment(p_provider_ref text, p_amount numeric, p_success boolean default true)
returns public.payment_state language plpgsql security definer set search_path = ''
as $$
declare v_p public.payments; v_due numeric;
begin
  if not public.is_service() then raise exception 'service role only'; end if;
  select * into v_p from public.payments where provider_ref = p_provider_ref for update;
  if v_p.id is null then raise exception 'unknown payment reference'; end if;
  if v_p.state <> 'pending' then return v_p.state; end if; -- idempotent for webhook retries

  if not p_success or p_amount <> v_p.amount then
    update public.payments set state = 'failed' where id = v_p.id;
    return 'failed';
  end if;
  begin
    v_due := public._amount_due(v_p.basket_id, v_p.kind);
  exception when others then
    update public.payments set state = 'failed' where id = v_p.id; -- e.g. deposit arrived after cutoff
    return 'failed';
  end;
  update public.payments set state = 'verified', verified_at = now() where id = v_p.id;
  perform public._apply_payment(v_p.id);
  return 'verified';
end;
$$;

-- Cash balance at pickup. ONLY an authorized agent for the building can record it, and it is
-- recorded at the moment of collection with a receipt number (ambassadors never touch cash).
create sequence public.cash_receipt_seq;
create or replace function public.record_cash_payment(p_basket uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_b public.baskets; v_amount numeric; v_id uuid; v_receipt text;
begin
  select * into v_b from public.baskets where id = p_basket for update;
  if v_b.id is null or not public.is_agent_for(v_b.building_id) then
    raise exception 'only an authorized agent for this building can collect cash';
  end if;
  v_amount := public._amount_due(p_basket, 'balance');
  if v_amount <= 0 then raise exception 'nothing is due'; end if;
  v_receipt := 'RC-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.cash_receipt_seq')::text, 5, '0');
  insert into public.payments (basket_id, user_id, kind, method, amount, state, collected_by, receipt_no, verified_at)
  values (p_basket, v_b.user_id, 'balance', 'cash_agent', v_amount, 'verified', auth.uid(), v_receipt, now())
  returning id into v_id;
  perform public._apply_payment(v_id);
  return v_receipt;
end;
$$;

-- Spend store credit against what's due now.
create or replace function public.apply_credit(p_basket uuid)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare v_b public.baskets; v_due numeric; v_kind public.payment_kind; v_amt numeric; v_id uuid;
begin
  select * into v_b from public.baskets where id = p_basket for update;
  if v_b.id is null or v_b.user_id <> auth.uid() then raise exception 'basket not found'; end if;
  v_kind := case when v_b.status = 'pending_deposit' then 'deposit'::public.payment_kind else 'balance'::public.payment_kind end;
  v_due := public._amount_due(p_basket, v_kind);
  v_amt := least(public.credit_balance(v_b.user_id), v_due);
  if v_amt <= 0 then raise exception 'no credit available'; end if;
  insert into public.payments (basket_id, user_id, kind, method, amount, state, verified_at)
  values (p_basket, v_b.user_id, v_kind, 'credit', v_amt, 'verified', now()) returning id into v_id;
  insert into public.credit_ledger (user_id, amount, reason, payment_id) values (v_b.user_id, -v_amt, 'Applied to order', v_id);
  perform public._apply_payment(v_id);
  return v_amt;
end;
$$;

-- Admin: agent's cash handed over to the bank (end-of-day reconciliation).
create or replace function public.mark_cash_deposited(p_agent uuid)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare v_total numeric;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  with upd as (
    update public.payments set deposited_at = now(), deposited_by = auth.uid()
     where collected_by = p_agent and method = 'cash_agent' and state = 'verified' and deposited_at is null
    returning amount)
  select coalesce(sum(amount), 0) into v_total from upd;
  return v_total;
end;
$$;

-- ===========================================================================
-- Cycle RPCs (admin)
-- ===========================================================================
-- Side-effect-free moves only (draft->open, ordered->dispatched, dispatched->delivered).
create or replace function public.transition_cycle(p_cycle uuid, p_to public.cycle_status, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_rpc text;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  select t.via_rpc into v_rpc from public.cycle_transitions t
    join public.buying_cycles c on c.status = t.from_status
   where c.id = p_cycle and t.to_status = p_to;
  if v_rpc is not null then raise exception 'use % for this step', v_rpc; end if;
  perform public._move_cycle(p_cycle, p_to, p_note);
end;
$$;

-- Cutoff: drop unpaid baskets, check each building's minimum (refund the ones that miss it),
-- aggregate paid demand into lots and auto-select the cheapest covering verified rate card.
create or replace function public.run_cutoff(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.buying_cycles; v_bld record; v_bk record;
  v_met int := 0; v_missed int := 0; v_refunded int := 0; v_dropped int := 0; v_lots int; v_unquoted int;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  select * into v_c from public.buying_cycles where id = p_cycle for update;
  if v_c.status <> 'open' then raise exception 'cutoff can only run on an open cycle'; end if;

  -- 1. Orders without a verified deposit don't count.
  for v_bk in select id, amount_paid from public.baskets
              where cycle_id = p_cycle and status in ('draft', 'pending_deposit') loop
    perform public._refund_basket(v_bk.id, 'Deposit not received before cutoff');
    v_dropped := v_dropped + 1;
  end loop;

  -- 2. Per-building minimum.
  for v_bld in
    select b.id,
           count(k.id) filter (where k.status = 'confirmed') as households,
           coalesce(sum(k.total) filter (where k.status = 'confirmed'), 0) as order_value
      from public.buildings b
      left join public.baskets k on k.building_id = b.id and k.cycle_id = p_cycle
     where b.cluster_id = v_c.cluster_id
     group by b.id
  loop
    insert into public.building_cycle_status (cycle_id, building_id, households, order_value, met_minimum)
    values (p_cycle, v_bld.id, v_bld.households, v_bld.order_value,
            v_bld.households >= v_c.min_households and v_bld.order_value >= v_c.min_order_value)
    on conflict (cycle_id, building_id) do update
      set households = excluded.households, order_value = excluded.order_value,
          met_minimum = excluded.met_minimum, evaluated_at = now();

    if v_bld.households >= v_c.min_households and v_bld.order_value >= v_c.min_order_value then
      v_met := v_met + 1;
    elsif v_bld.households > 0 then
      v_missed := v_missed + 1;
      for v_bk in select id from public.baskets
                  where cycle_id = p_cycle and building_id = v_bld.id and status = 'confirmed' loop
        perform public._refund_basket(v_bk.id,
          format('Your building did not reach this month''s minimum (%s households, Rs %s)', v_c.min_households, v_c.min_order_value));
        v_refunded := v_refunded + 1;
      end loop;
    end if;
  end loop;

  -- 3. Aggregate paid demand into lots.
  delete from public.demand_lots where cycle_id = p_cycle;
  insert into public.demand_lots (cycle_id, product_id, total_household_units, bulk_units, leftover_units, revenue)
  select p_cycle, i.product_id, sum(i.qty)::int,
         ceil(sum(i.qty)::numeric / p.split_factor)::int,
         (ceil(sum(i.qty)::numeric / p.split_factor) * p.split_factor - sum(i.qty))::int,
         sum(i.qty * i.unit_price)
    from public.basket_items i
    join public.baskets k on k.id = i.basket_id and k.cycle_id = p_cycle and k.status = 'confirmed'
    join public.products p on p.id = i.product_id
   group by i.product_id, p.split_factor;

  -- 4. Cheapest verified rate card that covers each lot's volume.
  update public.demand_lots l
     set quote_id = (
       select q.id from public.supplier_quotes q
       join public.suppliers s on s.id = q.supplier_id and s.verified
       where q.cycle_id = l.cycle_id and q.product_id = l.product_id
         and q.min_bulk_units <= l.bulk_units
         and (q.max_bulk_units is null or q.max_bulk_units >= l.bulk_units)
       order by q.price_per_bulk, s.rating desc limit 1)
   where l.cycle_id = p_cycle;

  select count(*), count(*) filter (where quote_id is null) into v_lots, v_unquoted
    from public.demand_lots where cycle_id = p_cycle;

  perform public._move_cycle(p_cycle, 'locked',
    format('Cutoff: %s buildings met, %s missed, %s orders refunded', v_met, v_missed, v_refunded + v_dropped));
  return jsonb_build_object('buildings_met', v_met, 'buildings_missed', v_missed,
    'orders_refunded', v_refunded, 'orders_dropped', v_dropped, 'lots', v_lots, 'lots_without_quote', v_unquoted);
end;
$$;

-- Admin override of the auto-selected supplier for a lot.
create or replace function public.select_quote(p_lot uuid, p_quote uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  if not exists (
    select 1 from public.demand_lots l
    join public.buying_cycles c on c.id = l.cycle_id and c.status = 'locked'
    join public.supplier_quotes q on q.id = p_quote and q.cycle_id = l.cycle_id and q.product_id = l.product_id
    join public.suppliers s on s.id = q.supplier_id and s.verified
    where l.id = p_lot and q.min_bulk_units <= l.bulk_units
      and (q.max_bulk_units is null or q.max_bulk_units >= l.bulk_units)) then
    raise exception 'that rate card cannot supply this lot';
  end if;
  update public.demand_lots set quote_id = p_quote where id = p_lot;
end;
$$;

-- Purchase orders, one per supplier, from deposit-backed demand only; one drop-off per building.
create or replace function public.issue_purchase_orders(p_cycle uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count int;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  if (select status from public.buying_cycles where id = p_cycle) <> 'locked' then
    raise exception 'purchase orders are issued after cutoff';
  end if;
  if exists (select 1 from public.demand_lots where cycle_id = p_cycle and bulk_units > 0 and quote_id is null) then
    raise exception 'some lots have no supplier yet';
  end if;

  insert into public.purchase_orders (cycle_id, supplier_id, subtotal)
  select p_cycle, q.supplier_id, sum(l.bulk_units * q.price_per_bulk)
    from public.demand_lots l join public.supplier_quotes q on q.id = l.quote_id
   where l.cycle_id = p_cycle and l.bulk_units > 0
   group by q.supplier_id;

  insert into public.po_lines (po_id, lot_id, bulk_qty, unit_price_bulk)
  select po.id, l.id, l.bulk_units, q.price_per_bulk
    from public.demand_lots l
    join public.supplier_quotes q on q.id = l.quote_id
    join public.purchase_orders po on po.cycle_id = p_cycle and po.supplier_id = q.supplier_id
   where l.cycle_id = p_cycle and l.bulk_units > 0;

  insert into public.deliveries (po_id, building_id)
  select distinct po.id, k.building_id
    from public.purchase_orders po
    join public.po_lines pl on pl.po_id = po.id
    join public.demand_lots l on l.id = pl.lot_id
    join public.basket_items i on i.product_id = l.product_id
    join public.baskets k on k.id = i.basket_id and k.cycle_id = p_cycle and k.status = 'confirmed'
   where po.cycle_id = p_cycle;

  select count(*) into v_count from public.purchase_orders where cycle_id = p_cycle;
  perform public._move_cycle(p_cycle, 'ordered', format('%s purchase orders issued', v_count));
  return v_count;
end;
$$;

-- Supplier accepts / dispatches its PO. When every PO is dispatched the cycle moves on.
create or replace function public.supplier_update_po(p_po uuid, p_status public.po_status)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po for update;
  if v_po.id is null or v_po.supplier_id not in (select public.my_supplier_ids()) then raise exception 'purchase order not found'; end if;
  if p_status = 'accepted' and v_po.status = 'pending' then
    update public.purchase_orders set status = 'accepted', accepted_at = now() where id = p_po;
  elsif p_status = 'dispatched' and v_po.status = 'accepted' then
    update public.purchase_orders set status = 'dispatched', dispatched_at = now() where id = p_po;
    if (select status from public.buying_cycles where id = v_po.cycle_id) = 'ordered'
       and not exists (select 1 from public.purchase_orders where cycle_id = v_po.cycle_id and status in ('pending', 'accepted')) then
      perform public._move_cycle(v_po.cycle_id, 'dispatched', 'All suppliers dispatched');
    end if;
  else
    raise exception 'cannot move purchase order from % to %', v_po.status, p_status;
  end if;
end;
$$;

-- Ambassador/agent confirms a supplier drop-off at the building.
create or replace function public.check_in_delivery(p_delivery uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_d public.deliveries; v_cycle uuid;
begin
  select * into v_d from public.deliveries where id = p_delivery for update;
  if v_d.id is null or not (public.is_ambassador_of(v_d.building_id) or public.is_agent_for(v_d.building_id) or public.is_admin()) then
    raise exception 'delivery not found';
  end if;
  update public.deliveries set delivered_at = now(), received_by = auth.uid(), notes = p_notes where id = p_delivery;
  select po.cycle_id into v_cycle from public.purchase_orders po where po.id = v_d.po_id;
  if (select status from public.buying_cycles where id = v_cycle) = 'dispatched'
     and not exists (select 1 from public.deliveries d join public.purchase_orders po on po.id = d.po_id
                     where po.cycle_id = v_cycle and d.delivered_at is null) then
    perform public._move_cycle(v_cycle, 'delivered', 'All building drop-offs checked in');
  end if;
end;
$$;

-- Open pickup: confirmed orders become ready; households are told what balance is due.
create or replace function public.start_distribution(p_cycle uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_bk record; v_n int := 0;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  for v_bk in update public.baskets set status = 'ready'
              where cycle_id = p_cycle and status = 'confirmed' returning id, user_id, balance_due loop
    perform public._notify(v_bk.user_id, 'ready', 'Your groceries are ready for pickup',
      case when v_bk.balance_due > 0 then format('Pay the balance of Rs %s online or in cash to the agent, then show your pickup code.', v_bk.balance_due)
           else 'Show your pickup code at the building pickup desk.' end,
      jsonb_build_object('basket_id', v_bk.id));
    v_n := v_n + 1;
  end loop;
  perform public._move_cycle(p_cycle, 'distributing', format('%s orders ready for pickup', v_n));
  return v_n;
end;
$$;

-- Close: uncollected orders are no-shows; the deposit is forfeited (it covers goods already bought).
-- Two no-shows -> the household must pay 100% upfront in future cycles.
create or replace function public.close_cycle(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_bk record; v_n int := 0; v_forfeit numeric := 0;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  for v_bk in update public.baskets set status = 'no_show', payment_status = 'forfeited'
              where cycle_id = p_cycle and status = 'ready' returning id, user_id, amount_paid loop
    update public.profiles
       set no_show_count = no_show_count + 1,
           reliability_score = greatest(reliability_score - 10, 0),
           upfront_only = (no_show_count + 1) >= 2
     where id = v_bk.user_id;
    perform public._notify(v_bk.user_id, 'no_show', 'Order not collected',
      format('Your order was not collected. The deposit of Rs %s is forfeited.', v_bk.amount_paid),
      jsonb_build_object('basket_id', v_bk.id));
    v_n := v_n + 1; v_forfeit := v_forfeit + v_bk.amount_paid;
  end loop;
  perform public._move_cycle(p_cycle, 'closed', format('%s no-shows, Rs %s forfeited', v_n, v_forfeit));
  return jsonb_build_object('no_shows', v_n, 'forfeited', v_forfeit);
end;
$$;

create or replace function public.cancel_cycle(p_cycle uuid, p_reason text default 'This month''s buying cycle was cancelled')
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_bk record; v_n int := 0;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  for v_bk in select id from public.baskets where cycle_id = p_cycle and status not in ('cancelled') loop
    perform public._refund_basket(v_bk.id, p_reason);
    v_n := v_n + 1;
  end loop;
  perform public._move_cycle(p_cycle, 'cancelled', p_reason);
  return v_n;
end;
$$;

-- ===========================================================================
-- Pickup RPCs
-- ===========================================================================
create or replace function public._otp_hash(p_basket uuid, p_code text)
returns text language sql immutable set search_path = ''
as $$ select encode(extensions.digest(p_basket::text || ':' || p_code, 'sha256'), 'hex'); $$;

-- Household gets a fresh 6-digit pickup code (only the hash is stored).
create or replace function public.generate_pickup_otp(p_basket uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_code text;
begin
  if not exists (select 1 from public.baskets where id = p_basket and user_id = auth.uid() and status = 'ready') then
    raise exception 'pickup code is available once your order is ready';
  end if;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.handovers (basket_id, otp_hash, expires_at)
  values (p_basket, public._otp_hash(p_basket, v_code), now() + interval '48 hours')
  on conflict (basket_id) do update
    set otp_hash = excluded.otp_hash, expires_at = excluded.expires_at, attempts = 0
    where public.handovers.handed_at is null;
  return v_code;
end;
$$;

-- Ambassador or agent hands over the order: requires the balance paid and the right code.
create or replace function public.complete_handover(p_basket uuid, p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_b public.baskets; v_h public.handovers;
begin
  select * into v_b from public.baskets where id = p_basket for update;
  if v_b.id is null or not (public.is_ambassador_of(v_b.building_id) or public.is_agent_for(v_b.building_id)) then
    raise exception 'order not found';
  end if;
  if v_b.status <> 'ready' then raise exception 'order is not ready for pickup (%)', v_b.status; end if;
  if v_b.payment_status <> 'paid_in_full' then
    raise exception 'balance of Rs % is not paid yet: pay online or in cash to the agent', v_b.balance_due;
  end if;
  select * into v_h from public.handovers where basket_id = p_basket for update;
  if v_h.basket_id is null then raise exception 'ask the resident to open their pickup code'; end if;
  if v_h.expires_at < now() then raise exception 'pickup code expired: ask the resident to refresh it'; end if;
  if v_h.attempts >= 5 then raise exception 'too many wrong codes: ask the resident to refresh it'; end if;
  if v_h.otp_hash <> public._otp_hash(p_basket, trim(p_code)) then
    update public.handovers set attempts = attempts + 1 where basket_id = p_basket;
    raise exception 'wrong pickup code';
  end if;
  update public.handovers set handed_at = now(), handed_by = auth.uid() where basket_id = p_basket;
  update public.baskets set status = 'collected', collected_at = now() where id = p_basket;
  perform public._notify(v_b.user_id, 'collected', 'Order collected', 'Enjoy your groceries! Report damaged or expired items within 48 hours.',
    jsonb_build_object('basket_id', p_basket));
end;
$$;

-- ===========================================================================
-- Returns: damaged / expired only, photo required, within 48h of pickup
-- ===========================================================================
create or replace function public.file_damage_claim(
  p_item uuid, p_type public.dispute_type, p_qty integer, p_photo_path text, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_i public.basket_items; v_b public.baskets; v_claimed int; v_amount numeric; v_batch uuid; v_id uuid;
  c_auto_limit constant numeric := 500;
begin
  select * into v_i from public.basket_items where id = p_item;
  select * into v_b from public.baskets where id = v_i.basket_id;
  if v_b.id is null or v_b.user_id <> auth.uid() then raise exception 'item not found'; end if;
  if v_b.status <> 'collected' then raise exception 'claims can be filed after pickup'; end if;
  if v_b.collected_at < now() - interval '48 hours' then raise exception 'claims must be filed within 48 hours of pickup'; end if;
  if coalesce(length(trim(p_photo_path)), 0) = 0 then raise exception 'a photo of the item is required'; end if;
  select coalesce(sum(qty), 0) into v_claimed from public.disputes where basket_item_id = p_item and status <> 'rejected';
  if p_qty < 1 or p_qty > v_i.qty - v_claimed then raise exception 'you can claim at most % of this item', v_i.qty - v_claimed; end if;

  v_amount := v_i.unit_price * p_qty;
  if v_amount <= c_auto_limit then
    insert into public.disputes (raised_by, basket_item_id, type, qty, claim_amount, photo_path, note, route, status, resolved_at, resolution)
    values (auth.uid(), p_item, p_type, p_qty, v_amount, p_photo_path, p_note, 'auto_refund', 'refunded', now(), 'Instant credit (low-value claim)')
    returning id into v_id;
    insert into public.credit_ledger (user_id, amount, reason, dispute_id)
    values (auth.uid(), v_amount, format('Instant refund: %s item', p_type), v_id);
  else
    insert into public.return_batches (building_id, cycle_id) values (v_b.building_id, v_b.cycle_id)
    on conflict (building_id, cycle_id) do update set status = public.return_batches.status
    returning id into v_batch;
    insert into public.disputes (raised_by, basket_item_id, type, qty, claim_amount, photo_path, note, route, batch_id)
    values (auth.uid(), p_item, p_type, p_qty, v_amount, p_photo_path, p_note, 'batch_return', v_batch)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.resolve_claim(p_dispute uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_d public.disputes;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  select * into v_d from public.disputes where id = p_dispute for update;
  if v_d.id is null or v_d.status <> 'open' then raise exception 'claim is not open'; end if;
  update public.disputes
     set status = case when p_approve then 'refunded'::public.dispute_status else 'rejected'::public.dispute_status end,
         resolution = p_note, resolved_by = auth.uid(), resolved_at = now()
   where id = p_dispute;
  if p_approve then
    insert into public.credit_ledger (user_id, amount, reason, dispute_id)
    values (v_d.raised_by, v_d.claim_amount, format('Refund: %s item (batch return)', v_d.type), p_dispute);
  end if;
  perform public._notify(v_d.raised_by, 'claim', case when p_approve then 'Claim approved' else 'Claim rejected' end,
    case when p_approve then format('Rs %s added to your credit.', v_d.claim_amount) else coalesce(p_note, 'Your claim was not approved.') end);
end;
$$;

-- ===========================================================================
-- Reporting RPCs
-- ===========================================================================
-- Live progress of a building toward this cycle's minimum (members, ambassador, agent, admin).
create or replace function public.building_progress(p_cycle uuid, p_building uuid)
returns table (households integer, pending integer, order_value numeric, min_households integer,
               min_order_value numeric, met_minimum boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (public.is_member_of(p_building) or public.is_agent_for(p_building) or public.is_admin()) then
    raise exception 'not a member of this building';
  end if;
  return query
  select (count(*) filter (where k.status not in ('draft', 'pending_deposit', 'cancelled')))::int,
         (count(*) filter (where k.status = 'pending_deposit'))::int,
         coalesce(sum(k.total) filter (where k.status not in ('draft', 'pending_deposit', 'cancelled')), 0),
         c.min_households, c.min_order_value,
         (count(*) filter (where k.status not in ('draft', 'pending_deposit', 'cancelled')) >= c.min_households
          and coalesce(sum(k.total) filter (where k.status not in ('draft', 'pending_deposit', 'cancelled')), 0) >= c.min_order_value)
    from public.buying_cycles c
    left join public.baskets k on k.cycle_id = c.id and k.building_id = p_building
   where c.id = p_cycle
   group by c.min_households, c.min_order_value;
end;
$$;

create or replace function public.admin_cycle_kpis(p_cycle uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not public.is_admin_or_service() then raise exception 'admin only'; end if;
  with k as (select * from public.baskets where cycle_id = p_cycle),
  sold as (select * from k where status in ('confirmed', 'ready', 'collected', 'no_show')),
  -- Whole cartons/sacks are bought; units beyond demand are surplus stock (offered next cycle),
  -- so margin is measured on the units actually sold.
  cost as (select coalesce(sum(l.bulk_units * q.price_per_bulk), 0) as total,
                  coalesce(sum(l.total_household_units * q.price_per_bulk / p.split_factor), 0) as cogs,
                  coalesce(sum(l.leftover_units * q.price_per_bulk / p.split_factor), 0) as surplus,
                  coalesce(sum(l.revenue), 0) as revenue
             from public.demand_lots l
             left join public.supplier_quotes q on q.id = l.quote_id
             join public.products p on p.id = l.product_id
            where l.cycle_id = p_cycle),
  pay as (select p.* from public.payments p join k on k.id = p.basket_id)
  select jsonb_build_object(
    'households', (select count(*) from sold),
    'gmv', (select coalesce(sum(total), 0) from sold),
    'retail_value', (select coalesce(sum(retail_total), 0) from sold),
    'purchase_value', (select round(total, 2) from cost),
    'cost_of_goods_sold', (select round(cogs, 2) from cost),
    'surplus_stock_value', (select round(surplus, 2) from cost),
    'lot_revenue', (select revenue from cost),
    'margin', (select round(revenue - cogs, 2) from cost),
    'margin_pct', (select case when revenue > 0 then round((revenue - cogs) / revenue * 100, 1) else 0 end from cost),
    'deposits_collected', (select coalesce(sum(amount), 0) from pay where kind = 'deposit' and state = 'verified'),
    'balances_collected', (select coalesce(sum(amount), 0) from pay where kind = 'balance' and state = 'verified'),
    'refunded', (select coalesce(sum(amount), 0) from pay where kind = 'refund'),
    'forfeited', (select coalesce(sum(amount_paid), 0) from k where status = 'no_show'),
    'cash_with_agents', (select coalesce(sum(amount), 0) from pay where method = 'cash_agent' and state = 'verified' and deposited_at is null),
    'collected', (select count(*) from k where status = 'collected'),
    'no_shows', (select count(*) from k where status = 'no_show'),
    'cancelled', (select count(*) from k where status = 'cancelled')
  ) into v;
  return v;
end;
$$;

-- ===========================================================================
-- Privileges
-- ===========================================================================
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, phone, locale) on public.profiles to authenticated;

revoke insert, update, delete on public.building_members from anon, authenticated;
revoke all on public.building_invites from anon, authenticated;
revoke all on public.handovers from anon, authenticated;
-- Baskets change only through RPCs (place_order, payments, cutoff, pickup).
revoke update on public.baskets from anon, authenticated;
revoke insert, update, delete on public.payments, public.credit_ledger, public.demand_lots,
  public.purchase_orders, public.po_lines, public.deliveries, public.disputes, public.return_batches,
  public.building_cycle_status, public.cycle_events from anon, authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert, delete on public.notifications from anon, authenticated;
revoke all on sequence public.cash_receipt_seq from anon, authenticated;

-- Internal functions: never callable through the API.
revoke execute on function public._notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._move_cycle(uuid, public.cycle_status, text) from public, anon, authenticated;
revoke execute on function public._recalc_basket(uuid) from public, anon, authenticated;
revoke execute on function public._apply_payment(uuid) from public, anon, authenticated;
revoke execute on function public._refund_basket(uuid, text) from public, anon, authenticated;
revoke execute on function public._amount_due(uuid, public.payment_kind) from public, anon, authenticated;
revoke execute on function public._otp_hash(uuid, text) from public, anon, authenticated;

-- Webhook-only.
revoke execute on function public.confirm_payment(text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, numeric, boolean) to service_role;

-- Signed-in only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.join_building_by_code(text, text)', 'public.request_join_building(uuid, text)',
    'public.review_membership(uuid, boolean)', 'public.get_building_invite(uuid)',
    'public.register_supplier(text, text, text, text, text, text)', 'public.place_order(uuid)',
    'public.start_payment(uuid, public.payment_kind, public.payment_method)', 'public.record_cash_payment(uuid)',
    'public.apply_credit(uuid)', 'public.mark_cash_deposited(uuid)',
    'public.transition_cycle(uuid, public.cycle_status, text)', 'public.run_cutoff(uuid)',
    'public.select_quote(uuid, uuid)', 'public.issue_purchase_orders(uuid)',
    'public.supplier_update_po(uuid, public.po_status)', 'public.check_in_delivery(uuid, text)',
    'public.start_distribution(uuid)', 'public.close_cycle(uuid)', 'public.cancel_cycle(uuid, text)',
    'public.generate_pickup_otp(uuid)', 'public.complete_handover(uuid, text)',
    'public.file_damage_claim(uuid, public.dispute_type, integer, text, text)',
    'public.resolve_claim(uuid, boolean, text)', 'public.building_progress(uuid, uuid)',
    'public.admin_cycle_kpis(uuid)', 'public.credit_balance(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles', 'clusters', 'buildings', 'building_invites', 'building_members',
    'agent_buildings', 'suppliers', 'supplier_users', 'categories', 'products', 'buying_cycles',
    'cycle_offers', 'supplier_quotes', 'building_cycle_status', 'baskets', 'basket_items', 'payments',
    'credit_ledger', 'demand_lots', 'purchase_orders', 'po_lines', 'deliveries', 'handovers',
    'return_batches', 'disputes', 'notifications', 'cycle_events', 'cycle_transitions'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.is_ambassador_of_user(id)
         or exists (select 1 from public.building_members m where m.user_id = profiles.id
                    and m.status = 'approved' and public.is_agent_for(m.building_id)));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Reference data
create policy clusters_read on public.clusters for select to anon, authenticated using (true);
create policy clusters_admin on public.clusters for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy buildings_read on public.buildings for select to authenticated using (true);
create policy buildings_admin on public.buildings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy categories_admin on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_read on public.products for select to anon, authenticated using (active or public.is_admin());
create policy products_admin on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cycles_read on public.buying_cycles for select to authenticated using (true);
create policy cycles_admin on public.buying_cycles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy offers_read on public.cycle_offers for select to anon, authenticated using (true);
create policy offers_admin on public.cycle_offers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cycle_transitions_read on public.cycle_transitions for select to authenticated using (true);
create policy cycle_events_read on public.cycle_events for select to authenticated using (true);

-- Buildings: invites, members, agents, cutoff results
create policy invites_ambassador on public.building_invites for select to authenticated
  using (public.is_ambassador_of(building_id) or public.is_admin());
create policy members_select on public.building_members for select to authenticated
  using (user_id = auth.uid() or public.is_ambassador_of(building_id) or public.is_agent_for(building_id) or public.is_admin());
create policy agent_buildings_select on public.agent_buildings for select to authenticated
  using (agent_id = auth.uid() or public.is_admin());
create policy agent_buildings_admin on public.agent_buildings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy bcs_select on public.building_cycle_status for select to authenticated
  using (public.is_member_of(building_id) or public.is_agent_for(building_id) or public.is_admin());

-- Suppliers & rate cards (competitors never see each other's prices)
create policy suppliers_select on public.suppliers for select to authenticated
  using (verified or id in (select public.my_supplier_ids()) or public.is_admin());
create policy suppliers_update_own on public.suppliers for update to authenticated
  using (id in (select public.my_supplier_ids())) with check (id in (select public.my_supplier_ids()));
create policy suppliers_admin on public.suppliers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy supplier_users_select on public.supplier_users for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy supplier_users_admin on public.supplier_users for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy quotes_select on public.supplier_quotes for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()) or public.is_admin());
create policy quotes_insert on public.supplier_quotes for insert to authenticated
  with check (supplier_id in (select public.my_verified_supplier_ids()));
create policy quotes_update on public.supplier_quotes for update to authenticated
  using (supplier_id in (select public.my_verified_supplier_ids()))
  with check (supplier_id in (select public.my_verified_supplier_ids()));
create policy quotes_delete on public.supplier_quotes for delete to authenticated
  using (supplier_id in (select public.my_verified_supplier_ids())
         and exists (select 1 from public.buying_cycles c where c.id = cycle_id and c.status in ('draft', 'open')));
create policy quotes_admin on public.supplier_quotes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Baskets & items
create policy baskets_select on public.baskets for select to authenticated
  using (user_id = auth.uid() or public.is_ambassador_of(building_id) or public.is_agent_for(building_id) or public.is_admin());
create policy baskets_insert on public.baskets for insert to authenticated
  with check (public.cycle_is_open(cycle_id) and public.can_write_basket(cycle_id, building_id, user_id));
create policy baskets_delete on public.baskets for delete to authenticated
  using (status = 'draft' and public.cycle_is_open(cycle_id) and public.can_write_basket(cycle_id, building_id, user_id));

create policy basket_items_select on public.basket_items for select to authenticated
  using (public.can_view_basket(basket_id));
create policy basket_items_insert on public.basket_items for insert to authenticated
  with check (public.basket_editable(basket_id));
create policy basket_items_update on public.basket_items for update to authenticated
  using (public.basket_editable(basket_id)) with check (public.basket_editable(basket_id));
create policy basket_items_delete on public.basket_items for delete to authenticated
  using (public.basket_editable(basket_id));

-- Payments & credit: read-only for clients; all writes via RPCs
create policy payments_select on public.payments for select to authenticated
  using (user_id = auth.uid() or collected_by = auth.uid() or public.is_admin()
         or exists (select 1 from public.baskets b where b.id = payments.basket_id and public.is_agent_for(b.building_id)));
create policy credit_select on public.credit_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Procurement
create policy lots_select on public.demand_lots for select to authenticated
  using (public.is_admin() or exists (select 1 from public.my_verified_supplier_ids()));
create policy po_select on public.purchase_orders for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()) or public.is_admin()
         or public.is_building_staff_for_po(id));
create policy po_lines_select on public.po_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = po_lines.po_id));
create policy deliveries_select on public.deliveries for select to authenticated
  using (public.is_ambassador_of(building_id) or public.is_agent_for(building_id) or public.is_admin()
         or public.is_my_po(po_id));

-- Returns
create policy disputes_select on public.disputes for select to authenticated
  using (raised_by = auth.uid() or public.is_admin()
         or exists (select 1 from public.return_batches rb where rb.id = disputes.batch_id
                    and public.is_ambassador_of(rb.building_id)));
create policy return_batches_select on public.return_batches for select to authenticated
  using (public.is_ambassador_of(building_id) or public.is_admin());

-- Notifications
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
