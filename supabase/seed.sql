-- BulkBasket demo seed: catalog, cluster/buildings, suppliers and one open buying cycle.
-- Retail prices are ILLUSTRATIVE benchmarks (PKR, per household unit) for the demo; update
-- them from real market surveys. Tier prices are ESTIMATES, to be validated by supplier bids.
-- Demo user accounts are created separately by `npm run seed:users` (needs the service-role key).

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name_en, name_ur, sort) values
  ('flour-grains',  'Flour & Grains',        'آٹا اور اناج',        1),
  ('rice',          'Rice',                  'چاول',               2),
  ('pulses',        'Pulses',                'دالیں',              3),
  ('oil-ghee',      'Cooking Oil & Ghee',    'تیل اور گھی',         4),
  ('sugar-salt',    'Sugar & Salt',          'چینی اور نمک',        5),
  ('tea-drinks',    'Tea & Beverages',       'چائے اور مشروبات',     6),
  ('spices',        'Spices',                'مصالحے',             7),
  ('dairy',         'Milk & Dairy',          'دودھ',               8),
  ('breakfast',     'Breakfast & Pantry',    'ناشتہ اور پینٹری',     9),
  ('laundry',       'Laundry',               'کپڑے دھونے کا سامان', 10),
  ('cleaning',      'Home Cleaning',         'گھر کی صفائی',        11),
  ('personal-care', 'Personal Care',         'ذاتی نگہداشت',        12),
  ('baby',          'Baby Care',             'بچوں کی اشیاء',       13)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Products: (category, name_en, name_ur, brand, household unit, bulk unit, split, retail, gst%)
-- ---------------------------------------------------------------------------
with p (cat, name_en, name_ur, brand, hh, bulk, split, retail, gst) as (values
  ('flour-grains', 'Chakki Atta 10 kg',            'چکی آٹا ۱۰ کلو',          'Sunridge',     '10 kg bag',     '50 kg sack',       5,  1450, 0),
  ('flour-grains', 'Fine Atta 10 kg',              'فائن آٹا ۱۰ کلو',          'Bake Parlor',  '10 kg bag',     '50 kg sack',       5,  1500, 0),
  ('flour-grains', 'Maida 1 kg',                   'میدہ ۱ کلو',              'Generic',      '1 kg pack',     '20 kg bag',       20,   160, 0),
  ('flour-grains', 'Besan 1 kg',                   'بیسن ۱ کلو',              'Mitchell''s',  '1 kg pack',     '20 kg bag',       20,   420, 0),
  ('flour-grains', 'Suji 1 kg',                    'سوجی ۱ کلو',              'Generic',      '1 kg pack',     '20 kg bag',       20,   180, 0),
  ('rice',         'Super Kernel Basmati 5 kg',    'سپر کرنل باسمتی ۵ کلو',    'Guard',        '5 kg bag',      '25 kg sack',       5,  2100, 0),
  ('rice',         'Sella Basmati 5 kg',           'سیلا باسمتی ۵ کلو',        'Falak',        '5 kg bag',      '25 kg sack',       5,  2250, 0),
  ('rice',         'Broken Rice (Tota) 5 kg',      'ٹوٹا چاول ۵ کلو',          'Generic',      '5 kg bag',      '25 kg sack',       5,   900, 0),
  ('pulses',       'Daal Chana 1 kg',              'دال چنا ۱ کلو',            'Generic',      '1 kg pack',     '40 kg sack',      40,   340, 0),
  ('pulses',       'Daal Masoor 1 kg',             'دال مسور ۱ کلو',           'Generic',      '1 kg pack',     '40 kg sack',      40,   380, 0),
  ('pulses',       'Daal Moong 1 kg',              'دال مونگ ۱ کلو',           'Generic',      '1 kg pack',     '40 kg sack',      40,   420, 0),
  ('pulses',       'Daal Mash 1 kg',               'دال ماش ۱ کلو',            'Generic',      '1 kg pack',     '40 kg sack',      40,   520, 0),
  ('pulses',       'White Chickpeas 1 kg',         'سفید چنے ۱ کلو',           'Generic',      '1 kg pack',     '40 kg sack',      40,   420, 0),
  ('pulses',       'Black Chickpeas 1 kg',         'کالے چنے ۱ کلو',           'Generic',      '1 kg pack',     '40 kg sack',      40,   300, 0),
  ('oil-ghee',     'Cooking Oil 5 L',              'کوکنگ آئل ۵ لیٹر',         'Dalda',        '5 L bottle',    'carton of 4',      4,  2900, 18),
  ('oil-ghee',     'Banaspati Ghee 5 kg',          'بناسپتی گھی ۵ کلو',        'Habib',        '5 kg tin',      'carton of 4',      4,  2700, 18),
  ('oil-ghee',     'Canola Oil 3 L',               'کینولا آئل ۳ لیٹر',        'Sufi',         '3 L bottle',    'carton of 4',      4,  1750, 18),
  ('oil-ghee',     'Sunflower Oil 1 L',            'سورج مکھی تیل ۱ لیٹر',      'Eva',          '1 L pouch',     'carton of 12',    12,   590, 18),
  ('sugar-salt',   'Sugar 5 kg',                   'چینی ۵ کلو',              'Generic',      '5 kg bag',      '50 kg sack',      10,   775, 0),
  ('sugar-salt',   'Iodized Salt 800 g',           'آیوڈین نمک ۸۰۰ گرام',      'National',     '800 g pack',    'carton of 24',    24,    60, 0),
  ('sugar-salt',   'Shakkar (Brown Sugar) 1 kg',   'شکر ۱ کلو',               'Generic',      '1 kg pack',     '20 kg bag',       20,   260, 0),
  ('tea-drinks',   'Danedar Tea 950 g',            'دانے دار چائے ۹۵۰ گرام',    'Tapal',        '950 g pack',    'carton of 12',    12,  1650, 18),
  ('tea-drinks',   'Yellow Label Tea 950 g',       'ییلو لیبل چائے ۹۵۰ گرام',   'Lipton',       '950 g pack',    'carton of 12',    12,  1750, 18),
  ('tea-drinks',   'Green Tea 30 bags',            'گرین ٹی ۳۰ بیگز',          'Tapal',        'box of 30',     'carton of 24',    24,   340, 18),
  ('tea-drinks',   'Rooh Afza 800 ml',             'روح افزا ۸۰۰ ملی لیٹر',     'Hamdard',      '800 ml bottle', 'carton of 12',    12,   520, 18),
  ('spices',       'Biryani Masala 2-pack',        'بریانی مصالحہ ڈبل پیک',     'Shan',         'double pack',   'carton of 72',    72,   200, 18),
  ('spices',       'Red Chilli Powder 200 g',      'لال مرچ پاؤڈر ۲۰۰ گرام',    'National',     '200 g pack',    'carton of 48',    48,   330, 18),
  ('spices',       'Turmeric Powder 200 g',        'ہلدی پاؤڈر ۲۰۰ گرام',       'National',     '200 g pack',    'carton of 48',    48,   230, 18),
  ('spices',       'Coriander Powder 200 g',       'دھنیا پاؤڈر ۲۰۰ گرام',      'National',     '200 g pack',    'carton of 48',    48,   230, 18),
  ('spices',       'Garam Masala 100 g',           'گرم مصالحہ ۱۰۰ گرام',       'Shan',         '100 g pack',    'carton of 48',    48,   260, 18),
  ('dairy',        'Full Cream Milk 1 L',          'فل کریم دودھ ۱ لیٹر',       'Olper''s',     '1 L pack',      'carton of 12',    12,   330, 18),
  ('dairy',        'Milkpak UHT Milk 1 L',         'ملک پاک دودھ ۱ لیٹر',       'Nestlé',       '1 L pack',      'carton of 12',    12,   330, 18),
  ('dairy',        'Tea Whitener 1 L',             'ٹی وائٹنر ۱ لیٹر',          'Tarang',       '1 L pack',      'carton of 12',    12,   280, 18),
  ('dairy',        'Milk Powder 900 g',            'خشک دودھ ۹۰۰ گرام',         'Nido',         '900 g pouch',   'carton of 12',    12,  1950, 18),
  ('breakfast',    'Mixed Fruit Jam 440 g',        'مکس فروٹ جام ۴۴۰ گرام',     'Mitchell''s',  '440 g jar',     'carton of 24',    24,   520, 18),
  ('breakfast',    'Corn Flakes 500 g',            'کارن فلیکس ۵۰۰ گرام',       'Fauji',        '500 g box',     'carton of 12',    12,   650, 18),
  ('breakfast',    'Macaroni 400 g',               'میکرونی ۴۰۰ گرام',          'Kolson',       '400 g pack',    'carton of 24',    24,   260, 18),
  ('breakfast',    'Chicken Noodles 4-pack',       'چکن نوڈلز ۴ پیک',           'Knorr',        '4-pack',        'carton of 24',    24,   380, 18),
  ('breakfast',    'Tomato Ketchup 800 g',         'ٹماٹو کیچپ ۸۰۰ گرام',       'National',     '800 g bottle',  'carton of 12',    12,   450, 18),
  ('laundry',      'Washing Powder 2 kg',          'واشنگ پاؤڈر ۲ کلو',         'Surf Excel',   '2 kg pack',     'carton of 6',      6,  1350, 18),
  ('laundry',      'Washing Powder 1 kg',          'واشنگ پاؤڈر ۱ کلو',         'Ariel',        '1 kg pack',     'carton of 12',    12,   900, 18),
  ('laundry',      'Detergent 1 kg',               'ڈٹرجنٹ ۱ کلو',             'Bonus Tristar','1 kg pack',     'carton of 12',    12,   450, 18),
  ('laundry',      'Fabric Softener 1 L',          'فیبرک سافٹنر ۱ لیٹر',        'Comfort',      '1 L bottle',    'carton of 12',    12,   650, 18),
  ('cleaning',     'Dishwash Bar 3-pack',          'برتن دھونے کی ٹکیہ ۳ پیک',    'Vim',          '3-pack',        'carton of 24',    24,   270, 18),
  ('cleaning',     'Toilet Cleaner 500 ml',        'ٹوائلٹ کلینر ۵۰۰ ملی لیٹر',   'Harpic',       '500 ml bottle', 'carton of 24',    24,   420, 18),
  ('cleaning',     'Antiseptic Liquid 500 ml',     'جراثیم کش لیکوئڈ ۵۰۰ ملی لیٹر', 'Dettol',      '500 ml bottle', 'carton of 24',    24,   980, 18),
  ('cleaning',     'Tissue Box 2-pack',            'ٹشو باکس ۲ پیک',            'Rose Petal',   '2-pack',        'carton of 24',    24,   220, 18),
  ('cleaning',     'Garbage Bags Large (30)',      'کچرے کے تھیلے بڑے (۳۰)',     'Generic',      'roll of 30',    'carton of 24',    24,   300, 18),
  ('personal-care','Soap 4-pack',                  'صابن ۴ پیک',               'Lifebuoy',     '4-pack',        'carton of 18',    18,   520, 18),
  ('personal-care','Soap 4-pack',                  'صابن ۴ پیک',               'Safeguard',    '4-pack',        'carton of 18',    18,   600, 18),
  ('personal-care','Toothpaste 150 g',             'ٹوتھ پیسٹ ۱۵۰ گرام',         'Colgate',      '150 g tube',    'carton of 48',    48,   330, 18),
  ('personal-care','Shampoo 360 ml',               'شیمپو ۳۶۰ ملی لیٹر',         'Sunsilk',      '360 ml bottle', 'carton of 24',    24,   820, 18),
  ('personal-care','Anti-Dandruff Shampoo 360 ml', 'خشکی کا شیمپو ۳۶۰ ملی لیٹر',  'Head & Shoulders', '360 ml bottle', 'carton of 24', 24, 1200, 18),
  ('baby',         'Diapers Medium (40)',          'ڈائپرز میڈیم (۴۰)',          'Canbebe',      'pack of 40',    'carton of 4',      4,  2800, 18),
  ('baby',         'Baby Cereal 350 g',            'بے بی سیریل ۳۵۰ گرام',       'Cerelac',      '350 g box',     'carton of 24',    24,  1300, 18)
)
insert into public.products
  (category_id, name_en, name_ur, brand, household_unit_label, bulk_unit_label,
   split_factor, reference_retail_price, gst_rate)
select c.id, p.name_en, p.name_ur, p.brand, p.hh, p.bulk, p.split, p.retail, p.gst
from p join public.categories c on c.slug = p.cat
where not exists (
  select 1 from public.products x where x.name_en = p.name_en and x.brand is not distinct from p.brand
);

-- ---------------------------------------------------------------------------
-- Estimated price tiers (per household unit), derived from the retail benchmark:
--   tier 0 (any demand)              ~5% below retail
--   tier 1 (~25 households of demand) ~12% below retail
--   tier 2 (~100 households)          ~20% below retail  (the 20-30% target is validated by bids)
-- ---------------------------------------------------------------------------
insert into public.price_tiers (product_id, min_bulk_units, est_unit_price)
select id, t.min_units, round(reference_retail_price * t.factor, 0)
from public.products,
lateral (values
  (0, 0.95),
  (greatest(1, ceil(25.0 / split_factor))::int, 0.88),
  (greatest(2, ceil(100.0 / split_factor))::int, 0.80)
) as t(min_units, factor)
on conflict (product_id, min_bulk_units) do nothing;

-- ---------------------------------------------------------------------------
-- Cluster, buildings, invite codes
-- ---------------------------------------------------------------------------
insert into public.clusters (id, name, city) values
  ('10000000-0000-0000-0000-000000000001', 'Gulberg Cluster', 'Lahore')
on conflict (id) do nothing;

insert into public.buildings (id, cluster_id, name, address, city, lat, lng, total_flats, verified) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Gulberg Heights', 'Main Boulevard, Gulberg III', 'Lahore', 31.5204, 74.3487, 48, true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Liberty Residency', 'Near Liberty Market, Gulberg', 'Lahore', 31.5106, 74.3446, 36, true),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'Mall View Apartments', 'Mall Road, Lahore', 'Lahore', 31.5546, 74.3294, 60, false)
on conflict (id) do nothing;

insert into public.building_invites (building_id, code) values
  ('20000000-0000-0000-0000-000000000001', 'GULB2026'),
  ('20000000-0000-0000-0000-000000000002', 'LIBR2026'),
  ('20000000-0000-0000-0000-000000000003', 'MALL2026')
on conflict (building_id) do nothing;

-- ---------------------------------------------------------------------------
-- Suppliers (fictional businesses)
-- ---------------------------------------------------------------------------
insert into public.suppliers (id, business_name, ntn, strn, contact_phone, contact_email, address, city, service_cities, verified, rating) values
  ('30000000-0000-0000-0000-000000000001', 'Al-Madina Wholesale Traders', '1234567-8', '17-00-1234-567-89',
   '+92 300 1111111', 'sales@almadina.example', 'Akbari Mandi, Lahore', 'Lahore', '{Lahore}', true, 4.6),
  ('30000000-0000-0000-0000-000000000002', 'Shah Alam Cash & Carry', '2345678-9', '17-00-2345-678-90',
   '+92 300 2222222', 'orders@shahalam.example', 'Shah Alam Market, Lahore', 'Lahore', '{Lahore}', true, 4.3),
  ('30000000-0000-0000-0000-000000000003', 'Punjab FMCG Distributors', null, null,
   '+92 300 3333333', 'hello@punjabfmcg.example', 'Badami Bagh, Lahore', 'Lahore', '{Lahore}', false, 0)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- One open buying cycle for the cluster, relative to "now" so the demo always works
-- ---------------------------------------------------------------------------
insert into public.buying_cycles
  (id, cluster_id, name, open_at, cutoff_at, bid_deadline, confirm_deadline, delivery_date, status, service_fee_pct)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   to_char(now(), 'FMMonth YYYY') || ' Bulk Buy',
   now() - interval '2 days', now() + interval '5 days', now() + interval '7 days',
   now() + interval '8 days', (now() + interval '10 days')::date, 'open', 2.5)
on conflict (id) do nothing;

insert into public.cycle_events (cycle_id, from_status, to_status, note)
select '40000000-0000-0000-0000-000000000001', 'draft', 'open', 'Seeded demo cycle'
where not exists (select 1 from public.cycle_events where cycle_id = '40000000-0000-0000-0000-000000000001');
