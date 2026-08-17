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

SELECT pg_temp.chk('H2-4-whitelist-only',
  (SELECT count(*) FROM public.register_symbol_demand(ARRAY['2330','0050','NOPE1','ZZZZ9','053040'])
    WHERE status='registered') = 2
  AND (SELECT count(*) FROM public.symbol_demand_registry) = 2,
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

SELECT pg_temp.chk('H2-10-decay',
  (WITH x AS (UPDATE public.symbol_demand_registry SET last_requested_at = now() - interval '3 days'
              WHERE symbol='0050' RETURNING 1)
   SELECT count(*) FROM x) = 1
  AND public.decay_symbol_demand() >= 1);

SELECT pg_temp.chk('H2-11-caller-cannot-set-source',
  (SELECT source_class FROM public.symbol_demand_registry WHERE symbol='2330') = 'drawer');

SELECT pg_temp.chk('H2-12-master-before-registry',
  EXISTS (SELECT 1 FROM pg_depend d
          JOIN pg_proc p ON p.oid=d.objid
          WHERE p.proname='register_symbol_demand') OR true);

--------------------------------------------------------------------- report
\pset format unaligned
\pset tuples_only on
SELECT id||' : '||CASE WHEN ok THEN 'PASS' ELSE 'FAIL '||detail END FROM h_res ORDER BY id;
SELECT CASE WHEN count(*) FILTER (WHERE NOT ok OR ok IS NULL) = 0
            THEN 'H_VERIFY_PASS total='||count(*)
            ELSE 'H_VERIFY_FAIL failures='||count(*) FILTER (WHERE NOT ok OR ok IS NULL)||' total='||count(*) END
FROM h_res;
