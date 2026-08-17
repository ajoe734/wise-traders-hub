-- R1 test fixture: production-shape columns (adapted from db/e0/11_fixture.sql)
INSERT INTO public.experts(id, slug, name, role, user_id, currency, asset_class, starting_capital) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','t-expert-a','Expert A','advisor',gen_random_uuid(),'TWD','tw_stock',1000000),
  ('bbbbbbbb-0000-0000-0000-000000000002','t-expert-b','Expert B','advisor',gen_random_uuid(),'TWD','tw_stock',500000),
  ('cccccccc-0000-0000-0000-000000000003','t-expert-c-us','Expert C','advisor',gen_random_uuid(),'USD','us_option',100000);

INSERT INTO public.daily_price_snapshots(symbol, market, trade_date, close_price)
SELECT s.sym, 'TW', d::date, s.base + (d::date - DATE '2026-08-03')*2
  FROM (VALUES ('T2330',100),('T2454',50)) s(sym, base),
       generate_series(DATE '2026-08-03', DATE '2026-08-07', '1 day') d
 WHERE extract(dow from d) BETWEEN 1 AND 5
ON CONFLICT DO NOTHING;

-- US: underlying only, no combo quote (mirrors production finding)
INSERT INTO public.daily_price_snapshots(symbol, market, trade_date, close_price)
SELECT 'TLUNR','US', d::date, 12
  FROM generate_series(DATE '2026-08-03', DATE '2026-08-07', '1 day') d
 WHERE extract(dow from d) BETWEEN 1 AND 5
ON CONFLICT DO NOTHING;

INSERT INTO public.expert_signals(id, expert_id, instrument, action, market, status)
VALUES ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'T2330','buy','TW','pending');

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','aaaaaaaa-0000-0000-0000-000000000001',
  'instrument','T2330','market','TW','currency','TWD',
  'qty',1000,'price',100,'effective_at','2026-08-03T05:00:00Z','reason','fixture buy'));

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','add','expert_id','aaaaaaaa-0000-0000-0000-000000000001',
  'instrument','T2330','market','TW','currency','TWD',
  'qty',1000,'price',110,'effective_at','2026-08-04T05:00:00Z','reason','fixture add'));

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','trim','expert_id','aaaaaaaa-0000-0000-0000-000000000001',
  'instrument','T2330','market','TW','currency','TWD',
  'qty',500,'price',120,'effective_at','2026-08-05T05:00:00Z','reason','fixture trim'));

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','bbbbbbbb-0000-0000-0000-000000000002',
  'instrument','T2454','market','TW','currency','TWD',
  'qty',100,'price',50,'effective_at','2026-08-03T05:00:00Z','reason','fixture buy b'));

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','cccccccc-0000-0000-0000-000000000003',
  'instrument','TLUNR 11/8P + 16/19C','market','US','currency','USD',
  'qty',10,'price',1.5,'effective_at','2026-08-03T13:30:00Z','reason','fixture combo'));
