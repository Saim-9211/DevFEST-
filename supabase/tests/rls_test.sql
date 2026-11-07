-- RLS & business-rule tests. Run after local_shim.sql + migrations + seed.sql:
--   npm run db:test   (see scripts/db-test.sh)
-- Each DO block runs in its own transaction; test.login() switches to the
-- 'authenticated' role with a fake JWT for the given user, just like PostgREST does.
\set ON_ERROR_STOP 1

create schema if not exists test;
grant usage on schema test to authenticated, anon;

create or replace function test.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function test.login(uuid) to authenticated, anon;

-- Expect a statement to fail; returns the error message.
create or replace function test.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL [%]: expected an error but statement succeeded', p_label;
exception when others then
  if sqlerrm like 'FAIL [%' then raise; end if;
  raise notice 'ok   [%] -> %', p_label, sqlerrm;
end $$;
grant execute on function test.expect_error(text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin@test',    '{"full_name":"Admin"}'),
  ('a0000000-0000-0000-0000-0000000000c1', 'captain@test',  '{"full_name":"Captain"}'),
  ('a0000000-0000-0000-0000-0000000000a1', 'ayesha@test',   '{"full_name":"Ayesha","role":"admin"}'),
  ('a0000000-0000-0000-0000-0000000000b1', 'bilal@test',    '{"full_name":"Bilal"}'),
  ('a0000000-0000-0000-0000-0000000000d1', 'pending@test',  '{"full_name":"Pending"}'),
  ('a0000000-0000-0000-0000-0000000000e1', 'other@test',    '{"full_name":"Other building"}'),
  ('a0000000-0000-0000-0000-0000000000f1', 'supplier@test', '{"full_name":"Supplier"}'),
  ('a0000000-0000-0000-0000-0000000000f2', 'unverified@test','{"full_name":"Unverified supplier"}');

do $$ begin
  assert (select role from public.profiles where id = 'a0000000-0000-0000-0000-0000000000a1') = 'resident',
    'metadata role must not escalate privileges';
  raise notice 'ok   [signup creates resident profile, ignores metadata role]';
end $$;

update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-00000000000a';
update public.profiles set role = 'supplier' where id in ('a0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-0000000000f2');

insert into public.building_members (building_id, user_id, flat_no, member_role, status) values
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'A-101', 'captain',  'approved'),
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'A-204', 'resident', 'approved'),
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'B-302', 'resident', 'approved'),
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', 'C-001', 'resident', 'pending'),
  ('20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000e1', 'L-1',   'resident', 'approved');

insert into public.supplier_users (supplier_id, user_id) values
  ('30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1'),
  ('30000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000f2');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000a1');
  perform test.expect_error($q$update public.profiles set role = 'admin' where id = auth.uid()$q$,
    'resident cannot change own role');
  update public.profiles set full_name = 'Ayesha Khan' where id = auth.uid();
  assert (select count(*) from public.profiles) = 1, 'resident sees only own profile';
  raise notice 'ok   [resident edits own name, sees only own profile]';
end $$;

do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000c1');
  assert (select count(*) from public.profiles) = 4,
    'captain sees profiles of own building members (self, ayesha, bilal, pending) only';
  raise notice 'ok   [captain sees only own building member profiles]';
end $$;

do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000f1');
  assert (select count(*) from public.profiles) = 1, 'supplier sees no resident profiles';
  assert (select count(*) from public.building_members) = 0, 'supplier sees no memberships';
  raise notice 'ok   [supplier cannot see residents]';
end $$;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000e1');
  perform test.expect_error($q$select public.join_building_by_code('gulb2026', 'a-204')$q$,
    'flat already registered cannot be claimed twice');
  perform test.expect_error($q$select public.join_building_by_code('NOPE', 'Z-1')$q$,
    'invalid invite code rejected');
  perform test.expect_error($q$insert into public.building_members (building_id, user_id, flat_no, status)
    values ('20000000-0000-0000-0000-000000000001', auth.uid(), 'X-9', 'approved')$q$,
    'cannot self-insert an approved membership');
  perform test.expect_error($q$select public.get_building_invite('20000000-0000-0000-0000-000000000001')$q$,
    'non-captain cannot read invite code');
end $$;

do $$ declare v_id uuid; begin
  select id into v_id from public.building_members where flat_no = 'C-001';  -- as superuser
  perform test.login('a0000000-0000-0000-0000-0000000000e1');
  perform test.expect_error(format('select public.review_membership(%L, true)', v_id),
    'non-captain cannot approve members');
end $$;

do $$ declare v_id uuid; begin
  perform test.login('a0000000-0000-0000-0000-0000000000c1');
  assert public.get_building_invite('20000000-0000-0000-0000-000000000001') = 'GULB2026', 'captain reads invite';
  select id into v_id from public.building_members where flat_no = 'C-001';
  perform public.review_membership(v_id, true);
  assert (select status from public.building_members where id = v_id) = 'approved', 'captain approved member';
  raise notice 'ok   [captain reads invite code and approves pending member]';
end $$;

-- ---------------------------------------------------------------------------
-- Baskets & pricing
-- ---------------------------------------------------------------------------
do $$ declare v_basket uuid; v_prod uuid; v_item record; begin
  perform test.login('a0000000-0000-0000-0000-0000000000a1');
  insert into public.baskets (cycle_id, user_id, building_id, status, payment_status)
  values ('40000000-0000-0000-0000-000000000001', auth.uid(), '20000000-0000-0000-0000-000000000001', 'confirmed', 'paid')
  returning id into v_basket;
  assert (select status from public.baskets where id = v_basket) = 'draft', 'insert forced to draft';
  assert (select payment_status from public.baskets where id = v_basket) = 'cod', 'payment forced to cod';

  select id into v_prod from public.products where name_en = 'Chakki Atta 10 kg';
  insert into public.basket_items (basket_id, product_id, qty, est_unit_price, final_unit_price)
  values (v_basket, v_prod, 2, 1, 1);
  select * into v_item from public.basket_items where basket_id = v_basket;
  assert v_item.est_unit_price = round(1450 * 0.95), 'estimate computed by server (tier 0), got ' || v_item.est_unit_price;
  assert v_item.final_unit_price is null, 'client cannot set final price';
  assert v_item.max_unit_price = round(v_item.est_unit_price * 1.10, 2), 'default max price = est + 10%';

  update public.baskets set status = 'submitted' where id = v_basket;
  assert (select submitted_at from public.baskets where id = v_basket) is not null, 'submitted_at set';
  perform test.expect_error(format($q$update public.baskets set status = 'confirmed' where id = %L$q$, v_basket),
    'cannot confirm while cycle is open');
  perform test.expect_error(format($q$update public.baskets set payment_status = 'paid' where id = %L$q$, v_basket),
    'cannot mark own basket paid');
  raise notice 'ok   [resident basket: forced defaults, server-side estimate, guarded status]';
end $$;

-- Tier pricing kicks in once cluster demand crosses thresholds (5 sacks = 25 bags for atta)
do $$ declare v_basket uuid; v_prod uuid; begin
  perform test.login('a0000000-0000-0000-0000-0000000000b1');
  insert into public.baskets (cycle_id, user_id, building_id)
  values ('40000000-0000-0000-0000-000000000001', auth.uid(), '20000000-0000-0000-0000-000000000001')
  returning id into v_basket;
  select id into v_prod from public.products where name_en = 'Chakki Atta 10 kg';
  insert into public.basket_items (basket_id, product_id, qty) values (v_basket, v_prod, 23);
  -- cluster total = 2 + 23 = 25 bags = 5 sacks -> tier 1 (12% off)
  assert (select est_unit_price from public.basket_items where basket_id = v_basket) = round(1450 * 0.88),
    'tier 1 estimate once demand reaches 5 sacks';
  assert (select count(*) from public.baskets) = 1, 'bilal sees only his own basket';
  raise notice 'ok   [tier pricing from live cluster demand; residents isolated]';
end $$;

do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000c1');
  assert (select count(*) from public.baskets) = 2, 'captain sees building baskets';
  -- captain orders on behalf of the newly approved resident
  insert into public.baskets (cycle_id, user_id, building_id)
  values ('40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-000000000001');
  assert (select placed_by from public.baskets where user_id = 'a0000000-0000-0000-0000-0000000000d1')
    = 'a0000000-0000-0000-0000-0000000000c1', 'placed_by records the captain';
  raise notice 'ok   [captain sees building baskets and orders on behalf]';
end $$;

do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000e1');
  assert (select count(*) from public.baskets) = 0, 'other building sees nothing';
  perform test.expect_error($q$insert into public.baskets (cycle_id, user_id, building_id)
    values ('40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001')$q$,
    'cannot create a basket for someone in another building');
end $$;

-- ---------------------------------------------------------------------------
-- Suppliers & bids
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000f2');
  update public.suppliers set verified = true, rating = 5 where id = '30000000-0000-0000-0000-000000000003';
end $$;
do $$ begin
  assert (select not verified and rating = 0 from public.suppliers where id = '30000000-0000-0000-0000-000000000003'),
    'supplier cannot self-verify';
  raise notice 'ok   [supplier cannot self-verify or set rating]';
end $$;

do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000f1');
  assert (select count(*) from public.baskets) = 0, 'supplier sees no baskets';
  assert (select count(*) from public.basket_items) = 0, 'supplier sees no basket items';
  raise notice 'ok   [supplier cannot see household orders]';
end $$;

-- ---------------------------------------------------------------------------
-- Cycle state machine
-- ---------------------------------------------------------------------------
do $$ begin
  perform test.login('a0000000-0000-0000-0000-0000000000a1');
  perform test.expect_error($q$select public.transition_cycle('40000000-0000-0000-0000-000000000001', 'locked')$q$,
    'resident cannot move the cycle');
end $$;

do $$ begin
  perform test.login('a0000000-0000-0000-0000-00000000000a');
  perform test.expect_error($q$select public.transition_cycle('40000000-0000-0000-0000-000000000001', 'closed')$q$,
    'illegal transition open -> closed rejected');
  perform public.transition_cycle('40000000-0000-0000-0000-000000000001', 'locked', 'cutoff');
  assert (select status from public.buying_cycles where id = '40000000-0000-0000-0000-000000000001') = 'locked', 'locked';
  assert (select count(*) from public.cycle_events where to_status = 'locked') = 1, 'transition audited';
  raise notice 'ok   [admin transition open -> locked, audited]';
end $$;

do $$ declare n int; begin
  perform test.login('a0000000-0000-0000-0000-0000000000a1');
  update public.basket_items set qty = 9;
  get diagnostics n = row_count;
  assert n = 0, 'basket items are frozen after lock';
  raise notice 'ok   [basket items frozen after cutoff/lock]';
end $$;

do $$ begin
  raise notice '=== ALL RLS TESTS PASSED ===';
end $$;
