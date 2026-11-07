-- CollectiveCart V2: RLS & business-rule tests. Runs after local_shim.sql + migrations + seed.sql
-- via `npm run db:test`. Each DO block is its own transaction; test.login() switches to the
-- 'authenticated' role with a fake JWT (what PostgREST does); test.service() acts as the webhook.
\set ON_ERROR_STOP 1

create schema if not exists test;
grant usage on schema test to authenticated, anon, service_role;

create or replace function test.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function test.service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

create or replace function test.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL [%]: expected an error but statement succeeded', p_label;
exception when others then
  if sqlerrm like 'FAIL [%' then raise; end if;
  raise notice 'ok   [%] -> %', p_label, sqlerrm;
end $$;

create or replace function test.u(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'admin'   then 'a0000000-0000-0000-0000-00000000000a'
    when 'amb'     then 'a0000000-0000-0000-0000-0000000000c1'
    when 'ayesha'  then 'a0000000-0000-0000-0000-0000000000a1'
    when 'bilal'   then 'a0000000-0000-0000-0000-0000000000b1'
    when 'nosh'    then 'a0000000-0000-0000-0000-0000000000b2'
    when 'pending' then 'a0000000-0000-0000-0000-0000000000d1'
    when 'jauhar'  then 'a0000000-0000-0000-0000-0000000000e1'
    when 'agent'   then 'a0000000-0000-0000-0000-0000000000a9'
    when 'agent2'  then 'a0000000-0000-0000-0000-0000000000a8'
    when 'jodia'   then 'a0000000-0000-0000-0000-0000000000f1'
    when 'saddar'  then 'a0000000-0000-0000-0000-0000000000f2'
    when 'korangi' then 'a0000000-0000-0000-0000-0000000000f3'
  end::uuid $$;

-- Resident creates a basket while trying to cheat on status/prices; the server must ignore it.
create or replace function test.make_basket(p_user text, p_building uuid, p_items text[], p_qty int[])
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform test.login(test.u(p_user));
  insert into public.baskets (cycle_id, user_id, building_id, status, total, amount_paid)
  values ('40000000-0000-0000-0000-000000000001', auth.uid(), p_building, 'confirmed', 1, 99999) returning id into v;
  for i in 1 .. array_length(p_items, 1) loop
    insert into public.basket_items (basket_id, product_id, qty, unit_price)
    values (v, (select id from public.products where name_en = p_items[i]), p_qty[i], 1);
  end loop;
  return v;
end $$;

-- Resident starts a payment; the gateway webhook confirms it (twice, to prove idempotency).
create or replace function test.pay(p_user text, p_kind public.payment_kind, p_method public.payment_method default 'raast')
returns public.payment_state language plpgsql as $$
declare v uuid; v_pay uuid; v_ref text; v_amt numeric; s public.payment_state;
begin
  perform test.login(test.u(p_user));
  select id into v from public.baskets where user_id = auth.uid();
  v_pay := public.start_payment(v, p_kind, p_method);
  perform set_config('role', 'postgres', true);
  select provider_ref, amount into v_ref, v_amt from public.payments where id = v_pay;
  perform test.service();
  s := public.confirm_payment(v_ref, v_amt);
  s := public.confirm_payment(v_ref, v_amt);
  return s;
end $$;

grant execute on all functions in schema test to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
select test.u(n), n || '@test', json_build_object('full_name', initcap(n), 'role', 'admin')::jsonb
from unnest(array['admin','amb','ayesha','bilal','nosh','pending','jauhar','agent','agent2','jodia','saddar','korangi']) n;

do $$ begin
  assert (select count(*) from public.profiles where role <> 'resident') = 0, 'metadata must not escalate role';
  raise notice 'ok   [sign-up always creates a resident profile]';
end $$;

update public.profiles set role = 'admin' where id = test.u('admin');
update public.profiles set role = 'agent' where id in (test.u('agent'), test.u('agent2'));
update public.profiles set role = 'supplier' where id in (test.u('jodia'), test.u('saddar'), test.u('korangi'));

insert into public.building_members (building_id, user_id, flat_no, member_role, status) values
  ('20000000-0000-0000-0000-000000000001', test.u('amb'),     'A-101', 'ambassador', 'approved'),
  ('20000000-0000-0000-0000-000000000001', test.u('ayesha'),  'A-204', 'resident',   'approved'),
  ('20000000-0000-0000-0000-000000000001', test.u('bilal'),   'B-302', 'resident',   'approved'),
  ('20000000-0000-0000-0000-000000000001', test.u('nosh'),    'B-404', 'resident',   'approved'),
  ('20000000-0000-0000-0000-000000000001', test.u('pending'), 'C-001', 'resident',   'pending'),
  ('20000000-0000-0000-0000-000000000002', test.u('jauhar'),  'J-1',   'resident',   'approved');
insert into public.agent_buildings values
  (test.u('agent'), '20000000-0000-0000-0000-000000000001'),
  (test.u('agent2'), '20000000-0000-0000-0000-000000000002');
insert into public.supplier_users values
  ('30000000-0000-0000-0000-000000000001', test.u('jodia')),
  ('30000000-0000-0000-0000-000000000002', test.u('saddar')),
  ('30000000-0000-0000-0000-000000000003', test.u('korangi'));
-- Small minimums so the test buildings can meet them.
update public.buying_cycles set min_households = 3, min_order_value = 3000;

-- ---------------------------------------------------------------------------
-- Profiles & membership
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login(test.u('ayesha'));
  perform test.expect_error($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, 'resident cannot change own role');
  assert (select count(*) from public.profiles) = 1, 'resident sees only own profile';
end $$;

do $$ declare v uuid; begin
  select id into v from public.building_members where flat_no = 'C-001';
  perform test.login(test.u('jauhar'));
  perform test.expect_error(format('select public.review_membership(%L, true)', v), 'non-ambassador cannot approve members');
  perform test.expect_error($q$select public.join_building_by_code('clif2026', 'a-204')$q$, 'a flat cannot be claimed twice');
  perform test.login(test.u('amb'));
  assert public.get_building_invite('20000000-0000-0000-0000-000000000001') = 'CLIF2026', 'ambassador reads invite';
  perform public.review_membership(v, true);
  assert (select status from public.building_members where id = v) = 'approved';
  raise notice 'ok   [ambassador approves members and reads the invite code]';
end $$;

-- ---------------------------------------------------------------------------
-- Rate cards & offers
-- ---------------------------------------------------------------------------
do $$ declare n int; begin
  perform test.login(test.u('jodia'));
  assert (select count(distinct supplier_id) from public.supplier_quotes) = 1, 'suppliers see only their own rate cards';
  update public.supplier_quotes set max_bulk_units = null
   where product_id = (select id from public.products where name_en = 'Sugar 5 kg');
  get diagnostics n = row_count;
  assert n = 1, 'verified supplier edits own rate card while the cycle is open';
  perform test.login(test.u('korangi'));
  update public.supplier_quotes set price_per_bulk = 1;
  get diagnostics n = row_count;
  assert n = 0, 'unverified supplier cannot change rate cards';
  raise notice 'ok   [rate cards: private per supplier; only verified suppliers can edit]';
end $$;

do $$ begin
  perform test.login(test.u('admin'));
  perform test.expect_error($q$update public.cycle_offers set offer_price = 1
    where product_id = (select id from public.products where name_en = 'Chakki Atta 10 kg')$q$,
    'loss guard: offer below wholesale cost rejected');
end $$;

-- ---------------------------------------------------------------------------
-- Ordering: server-side prices, totals and deposit
-- ---------------------------------------------------------------------------
do $$ declare v uuid; b record; begin
  v := test.make_basket('ayesha', '20000000-0000-0000-0000-000000000001',
        array['Chakki Atta 10 kg', 'Daal Chana 1 kg', 'Iodized Salt 800 g'], array[2, 3, 2]);
  select * into b from public.baskets where id = v;
  assert b.status = 'draft' and b.amount_paid = 0, 'client cannot pre-set status or paid amount';
  assert b.total = (select sum(i.qty * o.offer_price) from public.basket_items i
                    join public.cycle_offers o on o.product_id = i.product_id where i.basket_id = v), 'total uses offer prices';
  assert b.total < b.retail_total, 'basket is cheaper than retail';
  assert b.deposit_due = ceil(b.total * 0.20), 'deposit is 20% rounded up';
  perform test.expect_error(format($q$update public.baskets set status = 'confirmed' where id = %L$q$, v), 'basket cannot be updated directly');
  raise notice 'ok   [basket: offer prices, totals and 20%% deposit computed by the server (total %, deposit %)]', b.total, b.deposit_due;
end $$;

do $$ declare v uuid; v_pay uuid; v_ref text; v_amt numeric; begin
  perform test.login(test.u('ayesha'));
  select id into v from public.baskets where user_id = auth.uid();
  perform test.expect_error(format($q$select public.start_payment(%L, 'deposit', 'raast')$q$, v), 'no deposit before the order is placed');
  perform public.place_order(v);
  v_pay := public.start_payment(v, 'deposit', 'raast');
  select provider_ref, amount into v_ref, v_amt from public.payments where id = v_pay;
  assert v_amt = (select deposit_due from public.baskets where id = v), 'payment amount = deposit due';
  perform test.expect_error(format($q$select public.confirm_payment(%L, %s)$q$, v_ref, v_amt), 'residents cannot confirm their own payment');
  perform test.expect_error($q$insert into public.payments (basket_id, user_id, kind, method, amount, state)
    select id, user_id, 'deposit', 'raast', 1, 'verified' from public.baskets where user_id = auth.uid()$q$, 'payments cannot be inserted directly');
end $$;

do $$ declare v_ref text; v_amt numeric; s public.payment_state; begin
  select provider_ref, amount into v_ref, v_amt from public.payments where user_id = test.u('ayesha') and state = 'pending';
  perform test.service();
  s := public.confirm_payment(v_ref, v_amt - 1);
  assert s = 'failed', 'amount mismatch fails the payment';
  raise notice 'ok   [webhook: wrong amount -> failed]';
end $$;

do $$ begin
  assert test.pay('ayesha', 'deposit') = 'verified', 'deposit verified';
  assert (select status = 'confirmed' and payment_status = 'deposit_paid' and amount_paid = deposit_due
          from public.baskets where user_id = test.u('ayesha')), 'basket confirmed with deposit paid';
  assert (select count(*) from public.notifications where user_id = test.u('ayesha') and type = 'order_confirmed') = 1, 'resident notified';
  raise notice 'ok   [deposit paid via webhook -> order confirmed (idempotent retries)]';
end $$;

do $$ declare n int; begin
  perform test.login(test.u('ayesha'));
  update public.basket_items set qty = 9;
  get diagnostics n = row_count;
  assert n = 0, 'items are frozen once the deposit is paid';
  raise notice 'ok   [basket items frozen after deposit]';
end $$;

-- More households: bilal & nosh (Clifton) pay; pending orders but never pays; jauhar pays (alone in Jauhar).
do $$ declare v uuid; begin
  v := test.make_basket('bilal', '20000000-0000-0000-0000-000000000001', array['Sugar 5 kg', 'Cooking Oil 5 L'], array[2, 1]);
  perform public.place_order(v);
  v := test.make_basket('nosh', '20000000-0000-0000-0000-000000000001', array['Daal Masoor 1 kg'], array[4]);
  perform public.place_order(v);
  v := test.make_basket('pending', '20000000-0000-0000-0000-000000000001', array['Daal Moong 1 kg'], array[2]);
  perform public.place_order(v);
  v := test.make_basket('jauhar', '20000000-0000-0000-0000-000000000002', array['Chakki Atta 10 kg'], array[5]);
  perform public.place_order(v);
end $$;
do $$ begin
  assert test.pay('bilal', 'deposit', 'jazzcash') = 'verified';
  assert test.pay('nosh', 'deposit', 'easypaisa') = 'verified';
  assert test.pay('jauhar', 'deposit') = 'verified';
end $$;

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login(test.u('bilal'));
  assert (select count(*) from public.baskets) = 1 and (select count(*) from public.payments) = 1, 'resident sees only own order/payments';
  perform test.login(test.u('amb'));
  assert (select count(*) from public.baskets) = 4, 'ambassador sees building orders';
  assert (select count(*) from public.payments) = 0, 'ambassador sees no payment records';
  perform test.login(test.u('jodia'));
  assert (select count(*) from public.baskets) = 0 and (select count(*) from public.payments) = 0, 'supplier sees no household data';
  perform test.login(test.u('agent2'));
  assert (select count(*) from public.baskets) = 1, 'agent sees only assigned buildings';
  raise notice 'ok   [visibility: residents / ambassador / supplier / agent]';
end $$;

do $$ declare r record; begin
  perform test.login(test.u('ayesha'));
  select * into r from public.building_progress('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  assert r.households = 3 and r.pending = 1 and r.met_minimum, 'Clifton progress: 3 paid, 1 pending, minimum met';
  perform test.expect_error($q$select * from public.building_progress('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$q$,
    'cannot read another building''s progress');
  raise notice 'ok   [live building progress toward the minimum]';
end $$;

-- ---------------------------------------------------------------------------
-- Cutoff
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login(test.u('ayesha'));
  perform test.expect_error($q$select public.run_cutoff('40000000-0000-0000-0000-000000000001')$q$, 'resident cannot run cutoff');
  perform test.login(test.u('admin'));
  perform test.expect_error($q$select public.transition_cycle('40000000-0000-0000-0000-000000000001', 'locked')$q$, 'locking requires run_cutoff');
end $$;

do $$ declare j jsonb; begin
  perform test.login(test.u('admin'));
  j := public.run_cutoff('40000000-0000-0000-0000-000000000001');
  raise notice 'cutoff -> %', j;
  assert (j ->> 'buildings_met')::int = 1 and (j ->> 'buildings_missed')::int = 1, 'Clifton met, Jauhar missed';
  assert (j ->> 'lots_without_quote')::int = 0, 'every lot has a supplier';
end $$;

do $$ begin
  assert (select status = 'cancelled' and payment_status = 'refunded' and amount_paid = 0
          from public.baskets where user_id = test.u('jauhar')), 'below-minimum building cancelled and refunded';
  assert (select count(*) from public.payments where user_id = test.u('jauhar') and kind = 'refund' and state = 'verified') = 1, 'refund issued';
  assert (select status from public.baskets where user_id = test.u('pending')) = 'cancelled', 'unpaid order dropped at cutoff';
  assert (select count(*) from public.baskets where building_id = '20000000-0000-0000-0000-000000000001' and status = 'confirmed') = 3, 'Clifton orders stay';
  assert not exists (select 1 from public.demand_lots l join public.supplier_quotes q on q.id = l.quote_id
                     where q.supplier_id = '30000000-0000-0000-0000-000000000003'), 'unverified supplier never selected';
  assert (select total_household_units from public.demand_lots l join public.products p on p.id = l.product_id
          where p.name_en = 'Chakki Atta 10 kg') = 2, 'lots contain paid demand only (Jauhar atta excluded)';
  raise notice 'ok   [cutoff: minimum check, refunds, unpaid orders dropped, lots from paid demand, verified suppliers only]';
end $$;

-- ---------------------------------------------------------------------------
-- Procurement & delivery
-- ---------------------------------------------------------------------------
do $$ declare n int; begin
  perform test.login(test.u('admin'));
  n := public.issue_purchase_orders('40000000-0000-0000-0000-000000000001');
  assert n = 2, 'one PO per selected supplier (Jodia + Saddar), got ' || n;
  assert (select count(*) from public.deliveries) = 2, 'drop-offs only for the building that met the minimum';
  raise notice 'ok   [purchase orders issued from deposit-backed demand]';
end $$;

do $$ declare v_po uuid; begin
  perform test.login(test.u('jodia'));
  select id into v_po from public.purchase_orders;
  perform test.expect_error(format($q$select public.supplier_update_po(%L, 'dispatched')$q$, v_po), 'cannot dispatch before accepting');
  perform public.supplier_update_po(v_po, 'accepted');
  perform public.supplier_update_po(v_po, 'dispatched');
  perform test.login(test.u('saddar'));
  select id into v_po from public.purchase_orders;
  perform public.supplier_update_po(v_po, 'accepted');
  perform public.supplier_update_po(v_po, 'dispatched');
end $$;
do $$ declare d uuid; begin
  assert (select status from public.buying_cycles) = 'dispatched', 'cycle dispatched when all POs are dispatched';
  perform test.login(test.u('amb'));
  for d in select id from public.deliveries loop perform public.check_in_delivery(d, 'All good'); end loop;
  perform set_config('role', 'postgres', true);
  assert (select status from public.buying_cycles) = 'delivered', 'cycle delivered when all drop-offs checked in';
  perform test.login(test.u('admin'));
  assert public.start_distribution('40000000-0000-0000-0000-000000000001') = 3, '3 orders ready';
  raise notice 'ok   [supplier accept/dispatch -> ambassador check-in -> distribution]';
end $$;

-- ---------------------------------------------------------------------------
-- Pickup: balance + OTP
-- ---------------------------------------------------------------------------
do $$ declare v uuid; v_code text; begin
  perform test.login(test.u('ayesha'));
  select id into v from public.baskets where user_id = auth.uid();
  v_code := public.generate_pickup_otp(v);
  perform set_config('test.ayesha_code', v_code, false);
  perform test.login(test.u('amb'));
  perform test.expect_error(format($q$select public.complete_handover(%L, %L)$q$, v, v_code), 'no handover before the balance is paid');
end $$;

do $$ declare v uuid; begin
  assert test.pay('ayesha', 'balance', 'jazzcash') = 'verified', 'balance paid online';
  assert (select payment_status from public.baskets where user_id = test.u('ayesha')) = 'paid_in_full';
  select id into v from public.baskets where user_id = test.u('ayesha');
  perform test.login(test.u('amb'));
  perform test.expect_error(format($q$select public.complete_handover(%L, '000000')$q$, v), 'wrong pickup code rejected');
  perform public.complete_handover(v, current_setting('test.ayesha_code'));
  perform set_config('role', 'postgres', true);
  assert (select status from public.baskets where id = v) = 'collected', 'collected';
  raise notice 'ok   [pickup: balance online + OTP handover]';
end $$;

do $$ declare v uuid; v_receipt text; v_code text; begin
  select id into v from public.baskets where user_id = test.u('bilal');
  perform test.login(test.u('amb'));
  perform test.expect_error(format('select public.record_cash_payment(%L)', v), 'ambassador cannot collect cash');
  perform test.login(test.u('agent2'));
  perform test.expect_error(format('select public.record_cash_payment(%L)', v), 'agent of another building cannot collect cash');
  perform test.login(test.u('agent'));
  v_receipt := public.record_cash_payment(v);
  assert v_receipt like 'RC-%', 'cash receipt number issued';
  perform test.login(test.u('bilal'));
  v_code := public.generate_pickup_otp(v);
  perform test.login(test.u('agent'));
  perform public.complete_handover(v, v_code);
  perform set_config('role', 'postgres', true);
  assert (select status = 'collected' and payment_status = 'paid_in_full' from public.baskets where id = v), 'cash order collected';
  assert (select collected_by from public.payments where receipt_no = v_receipt) = test.u('agent'), 'cash attributed to agent';
  raise notice 'ok   [cash only via the assigned agent, with receipt %]', v_receipt;
end $$;

-- ---------------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------------
do $$ declare v_salt uuid; v_atta uuid; v_id uuid; begin
  perform test.login(test.u('ayesha'));
  select i.id into v_salt from public.basket_items i join public.products p on p.id = i.product_id where p.name_en = 'Iodized Salt 800 g';
  select i.id into v_atta from public.basket_items i join public.products p on p.id = i.product_id where p.name_en = 'Chakki Atta 10 kg';
  perform test.expect_error(format($q$select public.file_damage_claim(%L, 'damaged', 1, '')$q$, v_salt), 'photo evidence required');
  perform test.expect_error(format($q$select public.file_damage_claim(%L, 'damaged', 5, 'x.jpg')$q$, v_salt), 'cannot claim more than ordered');
  v_id := public.file_damage_claim(v_salt, 'damaged', 1, 'ayesha/salt.jpg');
  assert (select route = 'auto_refund' and status = 'refunded' from public.disputes where id = v_id), 'low-value claim auto-refunded';
  assert public.credit_balance() = (select unit_price from public.basket_items where id = v_salt), 'credit added';
  v_id := public.file_damage_claim(v_atta, 'expired', 1, 'ayesha/atta.jpg');
  assert (select route = 'batch_return' and status = 'open' and batch_id is not null from public.disputes where id = v_id), 'high-value claim goes to batch return';
  perform test.login(test.u('admin'));
  perform public.resolve_claim(v_id, true, 'Batch inspected');
  perform test.login(test.u('ayesha'));
  assert public.credit_balance() > 1000, 'batch claim refunded to credit';
  raise notice 'ok   [returns: photo required, <= Rs 500 instant credit, larger claims via batch return]';
end $$;

-- ---------------------------------------------------------------------------
-- Close: no-show forfeits deposit; reconciliation; KPIs
-- ---------------------------------------------------------------------------
do $$ declare j jsonb; v_cash numeric; begin
  perform test.login(test.u('admin'));
  j := public.close_cycle('40000000-0000-0000-0000-000000000001');
  assert (j ->> 'no_shows')::int = 1, 'one no-show';
  perform set_config('role', 'postgres', true);
  assert (select status = 'no_show' and payment_status = 'forfeited' from public.baskets where user_id = test.u('nosh')), 'deposit forfeited';
  assert (select no_show_count = 1 and not upfront_only and reliability_score = 90 from public.profiles where id = test.u('nosh')), 'no-show recorded';
  perform test.login(test.u('admin'));
  v_cash := public.mark_cash_deposited(test.u('agent'));
  perform set_config('role', 'postgres', true);
  assert v_cash = (select amount from public.payments where method = 'cash_agent'), 'agent cash reconciled';
  perform test.login(test.u('admin'));
  j := public.admin_cycle_kpis('40000000-0000-0000-0000-000000000001');
  raise notice 'kpis -> %', j;
  assert (j ->> 'margin')::numeric > 0, 'platform margin is positive';
  assert (j ->> 'cash_with_agents')::numeric = 0, 'no unreconciled cash';
  perform test.login(test.u('ayesha'));
  perform test.expect_error($q$select public.admin_cycle_kpis('40000000-0000-0000-0000-000000000001')$q$, 'KPIs are admin only');
  raise notice 'ok   [close: no-show forfeits deposit; cash reconciled; KPIs]';
end $$;

-- Second no-show -> 100% upfront in future cycles (simulated)
do $$ begin
  update public.profiles set no_show_count = 1 where id = test.u('bilal');
  update public.baskets set status = 'ready' where user_id = test.u('bilal');
  update public.buying_cycles set status = 'distributing';
  perform test.login(test.u('admin'));
  perform public.close_cycle('40000000-0000-0000-0000-000000000001');
  perform set_config('role', 'postgres', true);
  assert (select upfront_only from public.profiles where id = test.u('bilal')), 'second no-show -> upfront only';
  raise notice 'ok   [repeat no-show switches the household to 100%% upfront]';
end $$;

do $$ begin raise notice '=== ALL COLLECTIVECART DB TESTS PASSED ==='; end $$;
