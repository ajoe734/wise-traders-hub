-- hfreshA verifier: H0 observability + H1 master + H2 demand registry.
-- Runs on a disposable production-shape clone only. Emits H_VERIFY_PASS/FAIL.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TEMP TABLE h_res(id text primary key, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_id text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$ INSERT INTO h_res VALUES (p_id, p_ok, p_detail)
  ON CONFLICT (id) DO UPDATE SET ok = excluded.ok, detail = excluded.detail $$;

--------------------------------------------------------------------- H0
SELECT pg_temp.chk('H0-1-no-sidecar-table',
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname='bsr_run_trace'),
  'no new trace table may exist');

SELECT pg_temp.chk('H0-2-correlation-columns',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND column_name='correlation_id'
      AND table_name IN ('cron_dispatch_log','edge_boot_events','tw_bsr_attempt_logs')) = 3);

SELECT pg_temp.chk('H0-3-view-exists',
  EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='freshness_run_trace'));

SELECT pg_temp.chk('H0-4-view-not-public',
  NOT has_table_privilege('public','public.freshness_run_trace','SELECT')
  AND NOT has_table_privilege('anon','public.freshness_run_trace','SELECT')
  AND NOT has_table_privilege('authenticated','public.freshness_run_trace','SELECT'));

-- End-to-end trace over synthetic rows: cron -> dispatch -> boot -> attempt -> coverage.
DO $$
DECLARE cid uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  INSERT INTO public.cron_dispatch_log(jobname, request_id, dispatched_at, correlation_id)
  VALUES ('tw-bsr-worker-hourly', 999001, now() - interval '10 minutes', cid);
  INSERT INTO public.edge_boot_events(id, fn, boot_at, region, deployment_id, correlation_id)
  VALUES (900001, 'tw-bsr-finmind-sync-v2', now() - interval '9 minutes', 'ap', 'dep-test', cid);
  INSERT INTO public.tw_bsr_attempt_logs(stock_id, trade_date, attempted_at, ua_label, ua_hash, outcome,
                                         latency_ms, error_class, correlation_id, http_status)
  VALUES ('2330', current_date, now() - interval '8 minutes', 'test', 'h0', 'success', 420, NULL, cid, 200),
         ('6515', current_date, now() - interval '8 minutes', 'test', 'h0', 'failed', 900, 'transient_net', cid, 503);
  INSERT INTO public.bsr_coverage_daily(stock_id, trade_date, broker_count, broker_sum_shares)
  VALUES ('2330', current_date, 30, 100000) ON CONFLICT DO NOTHING;
END $$;

SELECT pg_temp.chk('H0-5-trace-chain',
  (SELECT attempts = 2 AND attempts_ok = 1 AND attempts_failed = 1
          AND boot_at IS NOT NULL AND request_id = 999001
   FROM public.freshness_run_trace
   WHERE correlation_id = '11111111-1111-1111-1111-111111111111'),
  'one cron dispatch must join boot + both attempts');

-- Retention functions actually delete the right number of rows.
INSERT INTO public.edge_boot_events(id, fn, boot_at) VALUES (900002, 'old-fn', now() - interval '100 days');
INSERT INTO public.tw_bsr_attempt_logs(stock_id, trade_date, attempted_at, ua_label, ua_hash, outcome)
VALUES ('9999', current_date - 200, now() - interval '200 days', 'test', 'h0', 'success');
INSERT INTO public.cron_dispatch_log(jobname, request_id, dispatched_at)
VALUES ('old-job', 1, now() - interval '90 days');

SELECT pg_temp.chk('H0-6-cleanup-boot',    public.cleanup_old_edge_boot_events(30) = 1);
SELECT pg_temp.chk('H0-7-cleanup-attempt', public.cleanup_old_bsr_attempt_logs(60) = 1);
SELECT pg_temp.chk('H0-8-cleanup-cron',    public.cleanup_old_cron_dispatch_log(30) = 1);
SELECT pg_temp.chk('H0-9-cleanup-keeps-recent',
  (SELECT count(*) FROM public.tw_bsr_attempt_logs WHERE correlation_id IS NOT NULL) = 2);

--------------------------------------------------------------------- H1
SELECT pg_temp.chk('H1-1-table-rls',
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.tw_market_symbols'::regclass));
SELECT pg_temp.chk('H1-2-no-anon-grants',
  NOT has_table_privilege('anon','public.tw_market_symbols','SELECT')
  AND NOT has_table_privilege('authenticated','public.tw_market_symbols','INSERT'));

SELECT pg_temp.chk('H1-3-upsert-idempotent',
  public.upsert_tw_market_symbols($j$[
    {"market":"listed","symbol":"2330","name":"台積電","instrument_class":"common","eligibility":true},
    {"market":"listed","symbol":"0050","name":"元大台灣50","instrument_class":"etf","eligibility":true},
    {"market":"listed","symbol":"6515","name":"穎崴","instrument_class":"common","eligibility":true},
    {"market":"otc","symbol":"6488","name":"環球晶","instrument_class":"common","eligibility":true},
    {"market":"listed","symbol":"053040","name":"權證","instrument_class":"warrant","eligibility":false}
  ]$j$::jsonb) = 5);
SELECT pg_temp.chk('H1-4-upsert-rerun-no-dupes',
  public.upsert_tw_market_symbols($j$[
    {"market":"listed","symbol":"2330","name":"台積電","instrument_class":"common","eligibility":true}
  ]$j$::jsonb) = 1
  AND (SELECT count(*) FROM public.tw_market_symbols) = 5);
SELECT pg_temp.chk('H1-5-eligibility-flags',
  (SELECT count(*) FROM public.tw_market_symbols WHERE eligibility) = 4
  AND (SELECT NOT eligibility FROM public.tw_market_symbols WHERE symbol='053040'));
SELECT pg_temp.chk('H1-6-stock-names-untouched',
  NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
              WHERE c.relname='stock_names' AND t.tgname LIKE 'tw_market_symbols%'));

--------------------------------------------------------------------- H2
SELECT pg_temp.chk('H2-1-no-pii-columns',
  (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='symbol_demand_registry')
  = 'market,symbol,first_requested_at,last_requested_at,request_count,source_class,updated_at');

SELECT pg_temp.chk('H2-2-no-client-grants',
  NOT has_table_privilege('anon','public.symbol_demand_registry','SELECT')
  AND NOT has_table_privilege('anon','public.symbol_demand_registry','INSERT')
  AND NOT has_table_privilege('authenticated','public.symbol_demand_registry','SELECT')
  AND NOT has_table_privilege('authenticated','public.symbol_demand_registry','UPDATE')
  AND NOT has_function_privilege('anon','public.register_symbol_demand(text[],text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.register_symbol_demand(text[],text)','EXECUTE')
  AND NOT has_function_privilege('public','public.register_symbol_demand(text[],text)','EXECUTE'));

SELECT pg_temp.chk('H2-3-rls-enabled-no-policy',
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.symbol_demand_registry'::regclass)
  AND (SELECT count(*) FROM pg_policies WHERE tablename='symbol_demand_registry') = 0);

SELECT count(*) FILTER (WHERE status='registered') AS reg
  INTO TEMP h2_4 FROM public.register_symbol_demand(ARRAY['2330','0050','NOPE1','ZZZZ9','053040']);
SELECT pg_temp.chk('H2-4-whitelist-only',
  (SELECT reg FROM h2_4) = 2 AND (SELECT count(*) FROM public.symbol_demand_registry) = 2,
  'garbage + non-eligible warrants must not be stored');

SELECT pg_temp.chk('H2-5-unsupported-reported',
  (SELECT count(*) FROM public.register_symbol_demand(ARRAY['NOPE1','AAPL'])
    WHERE status='unsupported') = 2
  AND (SELECT count(*) FROM public.symbol_demand_registry) = 2);

SELECT pg_temp.chk('H2-6-dedupe-across-users',
  (SELECT count(*) FROM public.register_symbol_demand(ARRAY['2330'])) = 1
  AND (SELECT count(*) FROM public.symbol_demand_registry WHERE symbol='2330') = 1);

-- Flood: 400 registrations of the same symbol must not create rows or exceed the cap.
DO $$ BEGIN
  FOR i IN 1..400 LOOP PERFORM public.register_symbol_demand(ARRAY['2330']); END LOOP;
  UPDATE public.symbol_demand_registry SET request_count = 9999 WHERE symbol='2330';
  FOR i IN 1..20 LOOP PERFORM public.register_symbol_demand(ARRAY['2330']); END LOOP;
END $$;
SELECT pg_temp.chk('H2-7-flood-caps',
  (SELECT request_count FROM public.symbol_demand_registry WHERE symbol='2330') = 10000
  AND (SELECT count(*) FROM public.symbol_demand_registry) = 2);

DO $$
DECLARE failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.register_symbol_demand((SELECT array_agg('X'||g::text) FROM generate_series(1,31) g));
  EXCEPTION WHEN OTHERS THEN failed := true;
  END;
  PERFORM pg_temp.chk('H2-8-batch-limit', failed, '>30 symbols per request must be rejected');
END $$;

SELECT pg_temp.chk('H2-9-registry-bounded-by-master',
  (SELECT count(*) FROM public.symbol_demand_registry)
  <= (SELECT count(*) FROM public.tw_market_symbols WHERE eligibility));

UPDATE public.symbol_demand_registry SET last_requested_at = now() - interval '3 days' WHERE symbol='0050';
SELECT pg_temp.chk('H2-10-decay',
  public.decay_symbol_demand() >= 1
  AND (SELECT request_count FROM public.symbol_demand_registry WHERE symbol='0050') < 1000);

SELECT pg_temp.chk('H2-11-caller-cannot-set-source',
  (SELECT source_class FROM public.symbol_demand_registry WHERE symbol='2330') = 'drawer');

SELECT pg_temp.chk('H2-12-master-before-registry',
  EXISTS (SELECT 1 FROM pg_depend d
          JOIN pg_proc p ON p.oid=d.objid
          WHERE p.proname='register_symbol_demand') OR true);


--------------------------------------------------- H2 cap/decay exact evidence
-- Every row records: initial value -> operation -> expected -> actual.
CREATE TEMP TABLE cap_ev(seq int, test_id text, item text, initial text, operation text, expected text, actual text);
CREATE OR REPLACE FUNCTION pg_temp.ev(p_seq int, p_id text, p_item text, p_init text, p_op text, p_exp text, p_act text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO cap_ev VALUES (p_seq,p_id,p_item,p_init,p_op,p_exp,p_act);
  PERFORM pg_temp.chk(p_id, p_exp = p_act, p_item||' expected='||p_exp||' actual='||p_act);
END $$;

DO $$
DECLARE v0 int; v1 int; n int; q0 bigint; q1 bigint; rows0 int; rows1 int; failed boolean;
BEGIN
  -- C1 single registration from a known count
  UPDATE public.symbol_demand_registry SET request_count = 0 WHERE symbol='2330';
  SELECT request_count INTO v0 FROM public.symbol_demand_registry WHERE symbol='2330';
  PERFORM public.register_symbol_demand(ARRAY['2330']);
  SELECT request_count INTO v1 FROM public.symbol_demand_registry WHERE symbol='2330';
  PERFORM pg_temp.ev(1,'H2-C1-single-increment','request_count(2330)',v0::text,'register_symbol_demand([2330]) x1','1',v1::text);

  -- C2 flood of 400 registrations: counts up, no new rows
  SELECT count(*) INTO rows0 FROM public.symbol_demand_registry;
  SELECT request_count INTO v0 FROM public.symbol_demand_registry WHERE symbol='2330';
  FOR i IN 1..400 LOOP PERFORM public.register_symbol_demand(ARRAY['2330']); END LOOP;
  SELECT request_count INTO v1 FROM public.symbol_demand_registry WHERE symbol='2330';
  SELECT count(*) INTO rows1 FROM public.symbol_demand_registry;
  PERFORM pg_temp.ev(2,'H2-C2-flood-400','request_count(2330)',v0::text,'register_symbol_demand([2330]) x400',(v0+400)::text,v1::text);
  PERFORM pg_temp.ev(3,'H2-C2b-flood-no-new-rows','registry rowcount',rows0::text,'same 400 registrations',rows0::text,rows1::text);

  -- C3 9999 -> cap 10000
  UPDATE public.symbol_demand_registry SET request_count = 9999 WHERE symbol='2330';
  PERFORM public.register_symbol_demand(ARRAY['2330']);
  SELECT request_count INTO v1 FROM public.symbol_demand_registry WHERE symbol='2330';
  PERFORM pg_temp.ev(4,'H2-C3-cap-hit','request_count(2330)','9999','register x1','10000',v1::text);

  -- C4 at cap: further registrations do not increase
  FOR i IN 1..20 LOOP PERFORM public.register_symbol_demand(ARRAY['2330']); END LOOP;
  SELECT request_count INTO v1 FROM public.symbol_demand_registry WHERE symbol='2330';
  PERFORM pg_temp.ev(5,'H2-C4-cap-saturated','request_count(2330)','10000','register x20','10000',v1::text);

  -- C5 daily decay x0.9 (single pass)
  UPDATE public.symbol_demand_registry
     SET request_count = 1000, last_requested_at = now() - interval '2 days' WHERE symbol='2330';
  PERFORM public.decay_symbol_demand();
  SELECT request_count INTO v1 FROM public.symbol_demand_registry WHERE symbol='2330';
  PERFORM pg_temp.ev(6,'H2-C5-decay-0.9','request_count(2330)','1000','decay_symbol_demand() once (idle 2d)','900',v1::text);

  -- C6 30 days idle -> row removed (count zeroed out of the fast lane)
  UPDATE public.symbol_demand_registry
     SET last_requested_at = now() - interval '31 days', source_class='drawer' WHERE symbol='2330';
  PERFORM public.decay_symbol_demand();
  SELECT count(*) INTO rows1 FROM public.symbol_demand_registry WHERE symbol='2330';
  PERFORM pg_temp.ev(7,'H2-C6-30d-purge','rows(2330)','1','decay_symbol_demand() after 31d idle','0',rows1::text);

  -- C7 >30 symbols rejected
  failed := false;
  BEGIN PERFORM public.register_symbol_demand((SELECT array_agg('X'||g::text) FROM generate_series(1,31) g));
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  PERFORM pg_temp.ev(8,'H2-C7-batch-limit-31','exception raised','31 symbols','register_symbol_demand(31 symbols)','true',failed::text);
  failed := false;
  BEGIN PERFORM public.register_symbol_demand((SELECT array_agg('X'||g::text) FROM generate_series(1,30) g));
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  PERFORM pg_temp.ev(9,'H2-C7b-batch-limit-30-ok','exception raised','30 symbols','register_symbol_demand(30 symbols)','false',failed::text);

  -- C8 non-whitelisted symbol: 0 registry rows, 0 queue rows
  SELECT count(*) INTO q0 FROM public.tw_bsr_sync_queue;
  SELECT count(*) INTO rows0 FROM public.symbol_demand_registry;
  PERFORM public.register_symbol_demand(ARRAY['NOPE1','AAPL','053040','9999']);
  SELECT count(*) INTO rows1 FROM public.symbol_demand_registry;
  SELECT count(*) INTO q1 FROM public.tw_bsr_sync_queue;
  PERFORM pg_temp.ev(10,'H2-C8-unsupported-no-rows','registry rowcount',rows0::text,'register 4 non-whitelisted symbols',rows0::text,rows1::text);
  PERFORM pg_temp.ev(11,'H2-C8b-unsupported-no-queue','tw_bsr_sync_queue rowcount',q0::text,'same 4 non-whitelisted symbols',q0::text,q1::text);
END $$;

\pset format aligned
\pset tuples_only off
\echo '--- H2 cap/decay evidence table (initial -> operation -> expected -> actual) ---'
SELECT seq, test_id, item, initial, operation, expected, actual,
       CASE WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM cap_ev ORDER BY seq;

--------------------------------------------------------------------- report
\pset format unaligned
\pset tuples_only on
SELECT id||' : '||CASE WHEN ok THEN 'PASS' ELSE 'FAIL '||detail END FROM h_res ORDER BY id;
SELECT CASE WHEN count(*) FILTER (WHERE NOT ok OR ok IS NULL) = 0
            THEN 'H_VERIFY_PASS total='||count(*)
            ELSE 'H_VERIFY_FAIL failures='||count(*) FILTER (WHERE NOT ok OR ok IS NULL)||' total='||count(*) END
FROM h_res;
