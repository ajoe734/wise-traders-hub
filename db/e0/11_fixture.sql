-- E0 fixtures (ephemeral only)
INSERT INTO public.experts(id, slug, base_currency, starting_capital) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','expert-a','TWD',1000000),
  ('bbbbbbbb-0000-0000-0000-000000000002','expert-b','TWD',500000),
  ('cccccccc-0000-0000-0000-000000000003','expert-c-us','USD',100000);

INSERT INTO public.daily_price_snapshots(symbol, market, trade_date, close_price)
SELECT s.sym, 'TW', d::date, s.base + (d::date - DATE '2026-08-03')*2
  FROM (VALUES ('2330',100),('2454',50)) s(sym, base),
       generate_series(DATE '2026-08-03', DATE '2026-08-07', '1 day') d
 WHERE extract(dow from d) BETWEEN 1 AND 5;

-- US: underlying only, no combo quote (mirrors production finding)
INSERT INTO public.daily_price_snapshots(symbol, market, trade_date, close_price)
SELECT 'LUNR','US', d::date, 12
  FROM generate_series(DATE '2026-08-03', DATE '2026-08-07', '1 day') d
 WHERE extract(dow from d) BETWEEN 1 AND 5;

INSERT INTO public.expert_signals(id, expert_id, status)
VALUES ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','pending');

-- Expert A trades
SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','aaaaaaaa-0000-0000-0000-000000000001',
  'instrument_key','2330:TW','instrument','2330 台積電','market','TW','currency','TWD',
  'qty',1000,'price',100,'effective_at','2026-08-03T05:00:00Z','reason','fixture buy'));

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','add','expert_id','aaaaaaaa-0000-0000-0000-000000000001',
  'instrument_key','2330:TW','instrument','2330 台積電','market','TW','currency','TWD',
  'qty',1000,'price',110,'effective_at','2026-08-04T05:00:00Z','reason','fixture add'));

SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','trim','expert_id','aaaaaaaa-0000-0000-0000-000000000001',
  'instrument_key','2330:TW','instrument','2330 台積電','market','TW','currency','TWD',
  'qty',500,'price',120,'effective_at','2026-08-05T05:00:00Z','reason','fixture trim'));

-- Expert B trades
SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','bbbbbbbb-0000-0000-0000-000000000002',
  'instrument_key','2454:TW','instrument','2454 聯發科','market','TW','currency','TWD',
  'qty',100,'price',50,'effective_at','2026-08-03T05:00:00Z','reason','fixture buy b'));

-- Expert C: US native combo (unsupported valuation)
SELECT app_ledger.canonical_apply_effect(jsonb_build_object(
  'action','buy','expert_id','cccccccc-0000-0000-0000-000000000003',
  'instrument_key','LUNR 11/8P + 16/19C','instrument','LUNR combo','market','US','currency','USD',
  'qty',10,'price',1.5,'effective_at','2026-08-03T13:30:00Z','reason','fixture combo'));
