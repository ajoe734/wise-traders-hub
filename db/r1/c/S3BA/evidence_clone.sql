-- S3B-A clone evidence（clone-only；全程 BEGIN…ROLLBACK，0 residue）
-- 產出：
--   blocked fixture：7 支各自 insert_delta=0 / revive_delta=0，claim=0
--   open fixture：7 支 return/payload 與 preimg.*（套用前逐字定義）逐項一致
-- 證據以 RAISE NOTICE 輸出（notice 不受 savepoint rollback 影響）
\set ON_ERROR_STOP on
BEGIN;

-- 遞迴移除 volatile 欄位（uuid／時鐘／metrics 快照），讓 payload 可逐字比對
CREATE OR REPLACE FUNCTION pg_temp.scrub(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $scrub$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN COALESCE((
        SELECT jsonb_object_agg(k, pg_temp.scrub(v))
          FROM jsonb_each(j) e(k, v)
         WHERE k NOT IN ('invocation_id','metrics_after','metrics_before','metrics',
                         'next_admission_at','target_date','next_run_at','completed_at',
                         'total_ms','duration_ms','generated_at','as_of','updated_at')
      ), '{}'::jsonb)
    WHEN 'array' THEN COALESCE((
        SELECT jsonb_agg(pg_temp.scrub(x)) FROM jsonb_array_elements(j) x), '[]'::jsonb)
    ELSE j END;
$scrub$;

SELECT count(*) AS q0 FROM public.tw_bsr_sync_queue \gset
SELECT md5(coalesce(string_agg(id||':'||status||':'||updated_at, ',' ORDER BY id),'')) AS h0
  FROM public.tw_bsr_sync_queue \gset
SELECT md5(coalesce(string_agg(key||':'||version||':'||config::text, ',' ORDER BY key),'')) AS c0
  FROM public.tw_bsr_sync_config \gset

-- ══════════════════════════════════════════════════════════════
-- BLOCKED FIXTURE
-- ══════════════════════════════════════════════════════════════
SAVEPOINT fx_blocked;

INSERT INTO public.tw_bsr_sync_config(key, version, config)
VALUES ('market_batch', 8, jsonb_build_object(
   'admission_blocked', true,
   'admission_reason', 'provider_plan_rejected',
   'admission_terminal_code', 'bsr_provider_unsupported'));

INSERT INTO public.chips_prefetch_targets(code, active) VALUES ('1104', true), ('1105', true);
INSERT INTO public.tw_bsr_sync_queue
  (stock_id, trade_date, priority, status, next_run_at, started_at, attempts, max_attempts,
   last_error, enqueued_by, correlation_id, post_close_only)
VALUES
  ('1104', current_date - 1, 1, 'running', now(), now() - interval '5 hours', 1, 5,
   NULL, 'ev_fixture_stale', gen_random_uuid(), false),
  ('1104', current_date - 2, 1, 'failed', now(), NULL, 1, 5,
   'finmind_admission_denied', 'ev_fixture_quota', gen_random_uuid(), false),
  ('1105', current_date - 3, 2, 'skipped', now(), NULL, 1, 5,
   'skipped_prev', 'ev_fixture_skipped', gen_random_uuid(), false);

DO $$
DECLARE
  fns text[] := ARRAY['ensure_bsr_queued','enqueue_all_active_tw_holdings_bsr',
                      'enqueue_chips_prefetch_gaps','recover_stale_bsr_queue_jobs',
                      'recover_quota_failed_bsr_jobs','enqueue_bsr_backfill',
                      'enqueue_bsr_first_fetch_on_trade'];
  f text; res jsonb; n int; c0 bigint; c1 bigint; p0 bigint; p1 bigint; rowsn int;
BEGIN
  FOREACH f IN ARRAY fns LOOP
    SELECT count(*) INTO c0 FROM public.tw_bsr_sync_queue;
    SELECT count(*) INTO p0 FROM public.tw_bsr_sync_queue WHERE status = 'pending';
    res := NULL; n := NULL;

    CASE f
      WHEN 'ensure_bsr_queued' THEN res := public.ensure_bsr_queued('1104');
      WHEN 'enqueue_all_active_tw_holdings_bsr' THEN res := public.enqueue_all_active_tw_holdings_bsr(3);
      WHEN 'enqueue_chips_prefetch_gaps' THEN res := public.enqueue_chips_prefetch_gaps(3, 10);
      WHEN 'recover_stale_bsr_queue_jobs' THEN res := public.recover_stale_bsr_queue_jobs(30, 5);
      WHEN 'recover_quota_failed_bsr_jobs' THEN res := public.recover_quota_failed_bsr_jobs(12);
      WHEN 'enqueue_bsr_backfill' THEN n := public.enqueue_bsr_backfill('1104', 60);
      WHEN 'enqueue_bsr_first_fetch_on_trade' THEN
        CREATE TEMP TABLE ev_probe(id bigserial primary key, market text, instrument text);
        CREATE TRIGGER ev_probe_trg AFTER INSERT ON ev_probe
          FOR EACH ROW EXECUTE FUNCTION public.enqueue_bsr_first_fetch_on_trade();
        INSERT INTO ev_probe(market, instrument) VALUES ('TW', '1104 台泥');
        SELECT count(*) INTO rowsn FROM ev_probe;
        ASSERT rowsn = 1, 'trigger 必須 RETURN NEW';
        DROP TRIGGER ev_probe_trg ON ev_probe; DROP TABLE ev_probe;
    END CASE;

    SELECT count(*) INTO c1 FROM public.tw_bsr_sync_queue;
    SELECT count(*) INTO p1 FROM public.tw_bsr_sync_queue WHERE status = 'pending';

    RAISE NOTICE 'BLOCKED % insert_delta=% revive_delta=% return=%',
      f, c1 - c0, p1 - p0, left(COALESCE(res::text, n::text, 'RETURN NEW (trigger)'), 300);

    ASSERT c1 = c0, format('blocked %s: insert_delta=%s 必須 0', f, c1 - c0);
    ASSERT p1 = p0, format('blocked %s: revive_delta=%s 必須 0', f, p1 - p0);
    IF res IS NOT NULL THEN
      ASSERT res->>'skipped' = 'bsr_provider_unsupported',
        format('blocked %s: 未回 skipped=bsr_provider_unsupported，實得 %s', f, res);
    END IF;
    IF f = 'enqueue_bsr_backfill' THEN
      ASSERT n = 0, format('blocked enqueue_bsr_backfill: 應回 0，實得 %s', n);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE s_stale text; s_quota text; s_skip text; k int;
BEGIN
  SELECT status INTO s_stale FROM public.tw_bsr_sync_queue WHERE enqueued_by='ev_fixture_stale';
  SELECT status INTO s_quota FROM public.tw_bsr_sync_queue WHERE enqueued_by='ev_fixture_quota';
  SELECT status INTO s_skip  FROM public.tw_bsr_sync_queue WHERE enqueued_by='ev_fixture_skipped';
  RAISE NOTICE 'BLOCKED fixture_rows statuses=%/%/% (running/failed/skipped 應原封不動)',
    s_stale, s_quota, s_skip;
  ASSERT s_stale='running' AND s_quota='failed' AND s_skip='skipped',
    format('blocked: fixture 狀態被改動 %s/%s/%s', s_stale, s_quota, s_skip);

  SELECT count(*) INTO k FROM public.claim_bsr_queue_jobs(10, 30);
  RAISE NOTICE 'BLOCKED claim_bsr_queue_jobs claimed=%', k;
  ASSERT k = 0, format('blocked: claim 應為 0，實得 %s', k);
END $$;

ROLLBACK TO SAVEPOINT fx_blocked;

-- ══════════════════════════════════════════════════════════════
-- OPEN FIXTURE：public.*（已加 guard）vs preimg.*（套用前逐字定義）
-- ══════════════════════════════════════════════════════════════
SAVEPOINT fx_open;

INSERT INTO public.tw_bsr_sync_config(key, version, config)
VALUES ('market_batch', 8, jsonb_build_object('admission_blocked', false));
INSERT INTO public.chips_prefetch_targets(code, active) VALUES ('1104', true), ('1105', true);
SAVEPOINT fx_open_base;

-- 1) ensure_bsr_queued
SELECT public.ensure_bsr_queued('1104')::text AS g1 \gset
ROLLBACK TO SAVEPOINT fx_open_base;
SELECT preimg.ensure_bsr_queued('1104')::text AS p1 \gset
ROLLBACK TO SAVEPOINT fx_open_base;

-- 2) enqueue_all_active_tw_holdings_bsr
SELECT public.enqueue_all_active_tw_holdings_bsr(3)::text AS g2 \gset
ROLLBACK TO SAVEPOINT fx_open_base;
SELECT preimg.enqueue_all_active_tw_holdings_bsr(3)::text AS p2 \gset
ROLLBACK TO SAVEPOINT fx_open_base;

-- 3) enqueue_chips_prefetch_gaps
SELECT public.enqueue_chips_prefetch_gaps(3, 10)::text AS g3 \gset
ROLLBACK TO SAVEPOINT fx_open_base;
SELECT preimg.enqueue_chips_prefetch_gaps(3, 10)::text AS p3 \gset
ROLLBACK TO SAVEPOINT fx_open_base;

-- 4) recover_stale_bsr_queue_jobs
SELECT public.recover_stale_bsr_queue_jobs(30, 5)::text AS g4 \gset
ROLLBACK TO SAVEPOINT fx_open_base;
SELECT preimg.recover_stale_bsr_queue_jobs(30, 5)::text AS p4 \gset
ROLLBACK TO SAVEPOINT fx_open_base;

-- 5) recover_quota_failed_bsr_jobs
SELECT public.recover_quota_failed_bsr_jobs(12)::text AS g5 \gset
ROLLBACK TO SAVEPOINT fx_open_base;
SELECT preimg.recover_quota_failed_bsr_jobs(12)::text AS p5 \gset
ROLLBACK TO SAVEPOINT fx_open_base;

-- 7) trigger 版（先做，避免與下面 DO 混用）
CREATE TEMP TABLE ev_t1(id bigserial primary key, market text, instrument text);
CREATE TRIGGER ev_t1_trg AFTER INSERT ON ev_t1
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_bsr_first_fetch_on_trade();
INSERT INTO ev_t1(market, instrument) VALUES ('TW','1104 台泥');
SELECT count(*) AS g7 FROM public.tw_bsr_sync_queue WHERE enqueued_by='trade_insert_hook_backfill' \gset
ROLLBACK TO SAVEPOINT fx_open_base;

CREATE TEMP TABLE ev_t2(id bigserial primary key, market text, instrument text);
CREATE TRIGGER ev_t2_trg AFTER INSERT ON ev_t2
  FOR EACH ROW EXECUTE FUNCTION preimg.enqueue_bsr_first_fetch_on_trade();
INSERT INTO ev_t2(market, instrument) VALUES ('TW','1104 台泥');
SELECT count(*) AS p7 FROM public.tw_bsr_sync_queue WHERE enqueued_by='trade_insert_hook_backfill' \gset
ROLLBACK TO SAVEPOINT fx_open_base;

-- 6) enqueue_bsr_backfill：未登入時原契約應丟例外（exception 自動回滾子區塊）
DO $$
DECLARE ea text; eb text; n int;
BEGIN
  BEGIN n := public.enqueue_bsr_backfill('1104', 5); ea := 'no_exception:'||n::text;
  EXCEPTION WHEN others THEN ea := SQLERRM; END;
  BEGIN n := preimg.enqueue_bsr_backfill('1104', 5); eb := 'no_exception:'||n::text;
  EXCEPTION WHEN others THEN eb := SQLERRM; END;
  RAISE NOTICE 'OPEN enqueue_bsr_backfill guarded=[%] preimage=[%]', ea, eb;
  ASSERT ea = eb, format('open enqueue_bsr_backfill 行為不符 %s vs %s', ea, eb);
END $$;

-- 比對（key set 一致 + payload 一致；volatile 欄位排除後必須逐字相等）
\pset format aligned
\echo '--- OPEN payload comparison (guarded vs preimage) ---'
SELECT fn,
       (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(g) k) AS keys_guarded,
       (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) k) AS keys_preimg,
       left(g::text, 300) AS payload_guarded,
       left(p::text, 300) AS payload_preimg,
       CASE WHEN pg_temp.scrub(g) = pg_temp.scrub(p)
             AND (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(g) k)
                 IS NOT DISTINCT FROM
                 (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) k)
             AND COALESCE(g->>'skipped','') <> 'bsr_provider_unsupported'
            THEN 'PASS' ELSE (1/0)::text END AS verdict
  FROM (VALUES
    ('ensure_bsr_queued',                  :'g1'::jsonb, :'p1'::jsonb),
    ('enqueue_all_active_tw_holdings_bsr', :'g2'::jsonb, :'p2'::jsonb),
    ('enqueue_chips_prefetch_gaps',        :'g3'::jsonb, :'p3'::jsonb),
    ('recover_stale_bsr_queue_jobs',       :'g4'::jsonb, :'p4'::jsonb),
    ('recover_quota_failed_bsr_jobs',      :'g5'::jsonb, :'p5'::jsonb)
  ) v(fn, g, p),
  LATERAL (SELECT ARRAY['invocation_id','metrics_after','next_admission_at',
                        'target_date','next_run_at','completed_at']::text[] AS vol) c;

\echo '--- OPEN trigger insert parity ---'
SELECT :'g7'::int AS inserted_guarded, :'p7'::int AS inserted_preimg,
       CASE WHEN :'g7'::int = :'p7'::int AND :'g7'::int > 0
            THEN 'PASS' ELSE (1/0)::text END AS verdict;


ROLLBACK TO SAVEPOINT fx_open;

-- ── residue ─────────────────────────────────────────────────────
\echo '--- RESIDUE (must equal pre-fixture snapshot) ---'
SELECT (SELECT count(*) FROM public.tw_bsr_sync_queue) AS queue_now,
       :'q0'::bigint AS queue_before,
       (SELECT md5(coalesce(string_agg(id||':'||status||':'||updated_at, ',' ORDER BY id),''))
          FROM public.tw_bsr_sync_queue) AS qhash_now,
       :'h0' AS qhash_before,
       (SELECT md5(coalesce(string_agg(key||':'||version||':'||config::text, ',' ORDER BY key),''))
          FROM public.tw_bsr_sync_config) AS chash_now,
       :'c0' AS chash_before,
       CASE WHEN (SELECT count(*) FROM public.tw_bsr_sync_queue) = :'q0'::bigint
             AND (SELECT md5(coalesce(string_agg(id||':'||status||':'||updated_at, ',' ORDER BY id),''))
                    FROM public.tw_bsr_sync_queue) = :'h0'
             AND (SELECT md5(coalesce(string_agg(key||':'||version||':'||config::text, ',' ORDER BY key),''))
                    FROM public.tw_bsr_sync_config) = :'c0'
            THEN 'RESIDUE_ZERO' ELSE (1/0)::text END AS verdict;

ROLLBACK;
