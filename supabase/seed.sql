-- CollectiveCart demo seed (Karachi): catalog, offers, supplier rate cards, buildings, open cycle.
-- Retail prices are ILLUSTRATIVE benchmarks (PKR per household unit); refresh them from a market
-- survey. Offer discounts follow V2's reality check: unbranded commodities 14-22% below retail,
-- branded FMCG only 4-8% (thin wholesale margins), so the whole basket lands around 10-15%.
-- Demo accounts, sample baskets and deposits come from `npm run seed:users`.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name_en, name_ur, sort) values
  ('flour-rice',  'Flour & Rice',       'آٹا اور چاول',        1),
  ('pulses',      'Pulses',             'دالیں',              2),
  ('sugar-salt',  'Sugar & Salt',       'چینی اور نمک',        3),
  ('spices',      'Spices',             'مصالحے',             4),
  ('oil-ghee',    'Cooking Oil & Ghee', 'تیل اور گھی',         5),
  ('tea-dairy',   'Tea & Milk',         'چائے اور دودھ',       6),
  ('pantry',      'Pantry',             'پینٹری',             7),
  ('household',   'Household',          'گھریلو سامان',        8)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Products: (cat, name_en, name_ur, brand, branded, household unit, bulk unit, split, retail)
-- ---------------------------------------------------------------------------
with p (cat, name_en, name_ur, brand, branded, hh, bulk, split, retail) as (values
  ('flour-rice', 'Chakki Atta 10 kg',          'چکی آٹا ۱۰ کلو',          null,           false, '10 kg bag',     '50 kg sack',    5, 1500),
  ('flour-rice', 'Super Kernel Basmati 5 kg',  'سپر کرنل باسمتی ۵ کلو',    null,           false, '5 kg bag',      '25 kg sack',    5, 2100),
  ('flour-rice', 'Sella Basmati 5 kg',         'سیلا باسمتی ۵ کلو',        null,           false, '5 kg bag',      '25 kg sack',    5, 2250),
  ('pulses',     'Daal Chana 1 kg',            'دال چنا ۱ کلو',            null,           false, '1 kg pack',     '40 kg sack',   40,  340),
  ('pulses',     'Daal Masoor 1 kg',           'دال مسور ۱ کلو',           null,           false, '1 kg pack',     '40 kg sack',   40,  380),
  ('pulses',     'Daal Moong 1 kg',            'دال مونگ ۱ کلو',           null,           false, '1 kg pack',     '40 kg sack',   40,  420),
  ('pulses',     'Daal Mash 1 kg',             'دال ماش ۱ کلو',            null,           false, '1 kg pack',     '40 kg sack',   40,  520),
  ('pulses',     'White Chickpeas 1 kg',       'سفید چنے ۱ کلو',           null,           false, '1 kg pack',     '40 kg sack',   40,  420),
  ('sugar-salt', 'Sugar 5 kg',                 'چینی ۵ کلو',              null,           false, '5 kg bag',      '50 kg sack',   10,  775),
  ('sugar-salt', 'Iodized Salt 800 g',         'آیوڈین نمک ۸۰۰ گرام',      'National',     true,  '800 g pack',    'carton of 24', 24,   60),
  ('spices',     'Red Chilli Powder 200 g',    'لال مرچ پاؤڈر ۲۰۰ گرام',    null,           false, '200 g pack',    '10 kg bag',    50,  260),
  ('spices',     'Turmeric Powder 200 g',      'ہلدی پاؤڈر ۲۰۰ گرام',       null,           false, '200 g pack',    '10 kg bag',    50,  180),
  ('spices',     'Coriander Powder 200 g',     'دھنیا پاؤڈر ۲۰۰ گرام',      null,           false, '200 g pack',    '10 kg bag',    50,  180),
  ('spices',     'Cumin Seeds 100 g',          'زیرہ ۱۰۰ گرام',            null,           false, '100 g pack',    '5 kg bag',     50,  280),
  ('spices',     'Biryani Masala 2-pack',      'بریانی مصالحہ ڈبل پیک',     'Shan',         true,  'double pack',   'carton of 72', 72,  200),
  ('oil-ghee',   'Cooking Oil 5 L',            'کوکنگ آئل ۵ لیٹر',         'Dalda',        true,  '5 L bottle',    'carton of 4',   4, 2900),
  ('oil-ghee',   'Banaspati Ghee 5 kg',        'بناسپتی گھی ۵ کلو',        'Habib',        true,  '5 kg tin',      'carton of 4',   4, 2700),
  ('oil-ghee',   'Sunflower Oil 1 L',          'سورج مکھی تیل ۱ لیٹر',      'Eva',          true,  '1 L pouch',     'carton of 12', 12,  590),
  ('tea-dairy',  'Danedar Tea 950 g',          'دانے دار چائے ۹۵۰ گرام',    'Tapal',        true,  '950 g pack',    'carton of 12', 12, 1650),
  ('tea-dairy',  'Yellow Label Tea 950 g',     'ییلو لیبل چائے ۹۵۰ گرام',   'Lipton',       true,  '950 g pack',    'carton of 12', 12, 1750),
  ('tea-dairy',  'UHT Full Cream Milk 1 L',    'فل کریم دودھ ۱ لیٹر',       'Olper''s',     true,  '1 L pack',      'carton of 12', 12,  330),
  ('tea-dairy',  'Tea Whitener 1 L',           'ٹی وائٹنر ۱ لیٹر',          'Tarang',       true,  '1 L pack',      'carton of 12', 12,  280),
  ('pantry',     'Macaroni 400 g',             'میکرونی ۴۰۰ گرام',          'Kolson',       true,  '400 g pack',    'carton of 24', 24,  260),
  ('pantry',     'Tomato Ketchup 800 g',       'ٹماٹو کیچپ ۸۰۰ گرام',       'National',     true,  '800 g bottle',  'carton of 12', 12,  450),
  ('household',  'Washing Powder 2 kg',        'واشنگ پاؤڈر ۲ کلو',         'Surf Excel',   true,  '2 kg pack',     'carton of 6',   6, 1350),
  ('household',  'Detergent 1 kg',             'ڈٹرجنٹ ۱ کلو',             'Bonus Tristar',true,  '1 kg pack',     'carton of 12', 12,  450),
  ('household',  'Dishwash Bar 3-pack',        'برتن دھونے کی ٹکیہ ۳ پیک',    'Vim',          true,  '3-pack',        'carton of 24', 24,  270),
  ('household',  'Toilet Cleaner 500 ml',      'ٹوائلٹ کلینر ۵۰۰ ملی لیٹر',   'Harpic',       true,  '500 ml bottle', 'carton of 24', 24,  420),
  ('household',  'Soap 4-pack',                'صابن ۴ پیک',               'Lifebuoy',     true,  '4-pack',        'carton of 18', 18,  520),
  ('household',  'Toothpaste 150 g',           'ٹوتھ پیسٹ ۱۵۰ گرام',         'Colgate',      true,  '150 g tube',    'carton of 48', 48,  330)
)
insert into public.products
  (category_id, name_en, name_ur, brand, branded, household_unit_label, bulk_unit_label, split_factor, reference_retail_price)
select c.id, p.name_en, p.name_ur, p.brand, p.branded, p.hh, p.bulk, p.split, p.retail
from p join public.categories c on c.slug = p.cat
where not exists (select 1 from public.products x where x.name_en = p.name_en);

-- ---------------------------------------------------------------------------
-- Cluster, buildings, invite codes (Karachi)
-- ---------------------------------------------------------------------------
insert into public.clusters (id, name, city) values
  ('10000000-0000-0000-0000-000000000001', 'Karachi Central-South', 'Karachi')
on conflict (id) do nothing;

insert into public.buildings (id, cluster_id, name, address, city, lat, lng, total_flats, verified) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Clifton Towers', 'Block 5, Clifton', 'Karachi', 24.8138, 67.0300, 40, true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Jauhar Heights', 'Block 13, Gulistan-e-Jauhar', 'Karachi', 24.9180, 67.1310, 32, true),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'PECHS Residency', 'Block 6, PECHS', 'Karachi', 24.8710, 67.0640, 24, false)
on conflict (id) do nothing;

insert into public.building_invites (building_id, code) values
  ('20000000-0000-0000-0000-000000000001', 'CLIF2026'),
  ('20000000-0000-0000-0000-000000000002', 'JAUH2026'),
  ('20000000-0000-0000-0000-000000000003', 'PECH2026')
on conflict (building_id) do nothing;

-- ---------------------------------------------------------------------------
-- Suppliers (fictional businesses)
-- ---------------------------------------------------------------------------
insert into public.suppliers (id, business_name, ntn, strn, contact_phone, contact_email, address, city, service_cities, verified, rating) values
  ('30000000-0000-0000-0000-000000000001', 'Jodia Bazaar Wholesale Co.', '4123456-7', '32-00-4123-456-78',
   '+923211111111', 'sales@jodiawholesale.example', 'Jodia Bazaar, Karachi', 'Karachi', '{Karachi}', true, 4.6),
  ('30000000-0000-0000-0000-000000000002', 'Saddar Cash & Carry', '4234567-8', '32-00-4234-567-89',
   '+923212222222', 'orders@saddarcc.example', 'Saddar, Karachi', 'Karachi', '{Karachi}', true, 4.4),
  ('30000000-0000-0000-0000-000000000003', 'Korangi FMCG Distributors', null, null,
   '+923213333333', 'hello@korangifmcg.example', 'Korangi Industrial Area, Karachi', 'Karachi', '{Karachi}', false, 0)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Open buying cycle (relative to "now" so the demo always works)
-- ---------------------------------------------------------------------------
insert into public.buying_cycles
  (id, cluster_id, name, open_at, cutoff_at, delivery_date, status, deposit_pct, min_order_value, min_households)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   to_char(now(), 'FMMonth YYYY') || ' Monthly Order',
   now() - interval '3 days', now() + interval '4 days', (now() + interval '7 days')::date,
   'open', 20, 120000, 8)
on conflict (id) do nothing;

insert into public.cycle_events (cycle_id, from_status, to_status, note)
select '40000000-0000-0000-0000-000000000001', 'draft', 'open', 'Seeded demo cycle'
where not exists (select 1 from public.cycle_events where cycle_id = '40000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Offers: fixed resident price per SKU for this cycle
-- ---------------------------------------------------------------------------
insert into public.cycle_offers (cycle_id, product_id, offer_price)
select '40000000-0000-0000-0000-000000000001', p.id,
       round(p.reference_retail_price * (1 - case
         when not p.branded and c.slug = 'pulses' then 0.20
         when not p.branded and c.slug = 'spices' then 0.22
         when not p.branded and c.slug = 'flour-rice' then 0.16
         when not p.branded then 0.14
         when c.slug in ('oil-ghee', 'tea-dairy') then 0.05
         else 0.07 end))
from public.products p join public.categories c on c.id = p.category_id
on conflict (cycle_id, product_id) do nothing;

-- ---------------------------------------------------------------------------
-- Supplier rate cards (price per bulk unit), leaving the platform a 3-8% spread.
--   Jodia: cheapest on unbranded commodities. Saddar: cheapest on branded goods.
--   Korangi: cheapest of all, but UNVERIFIED, so cutoff will not select it.
-- ---------------------------------------------------------------------------
insert into public.supplier_quotes (cycle_id, supplier_id, product_id, price_per_bulk, min_bulk_units)
select o.cycle_id, s.supplier_id, o.product_id,
       round(o.offer_price * p.split_factor * (1 - s.margin), 2), 1
from public.cycle_offers o
join public.products p on p.id = o.product_id
cross join lateral (values
  ('30000000-0000-0000-0000-000000000001'::uuid, case when p.branded then 0.025 else 0.08 end),
  ('30000000-0000-0000-0000-000000000002'::uuid, case when p.branded then 0.045 else 0.05 end),
  ('30000000-0000-0000-0000-000000000003'::uuid, case when p.branded then 0.06 else 0.10 end)
) as s(supplier_id, margin)
where o.cycle_id = '40000000-0000-0000-0000-000000000001'
on conflict (cycle_id, supplier_id, product_id) do nothing;
