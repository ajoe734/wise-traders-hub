-- P7-A：enqueue_institutional_backfill_universe 公平配額 / backoff / terminal 測試
--
-- 執行：
--   bash scripts/ephemeral-pg.sh up-slice
--   bash scripts/ephemeral-pg.sh load-slice
--   bash scripts/ephemeral-pg.sh run-file supabase/tests/fixtures/bsr_e2e_schema.sql \
--        supabase/tests/fixtures/bsr_e2e_functions.sql \
--        supabase/tests/institutional_fairness_backoff_test.sql
--
-- 本檔自帶 slice/e2e fixture 未涵蓋的最小 schema（institutional_new_stock_queue、
-- v_active_tw_holdings），因此不需要修改任何 fixture 檔。

\set ON_ERROR_STOP on

-- ── 最小前置 schema（production DDL 等價） ─────────────────
CREATE TABLE IF NOT EXISTS public.institutional_new_stock_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','running','done','dead'])),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.v_active_tw_holdings AS
SELECT DISTINCT substring(instrument, '^([1-9][0-9]{3})(?:\s|$)') AS stock_id
  FROM public.trade_records tr
 WHERE market = 'TW' AND status::text = 'open'
   AND instrument ~ '^[1-9][0-9]{3}(?:\s|$)';

-- ── 受測函式（與 P7-A migration 逐字相同；apply 後以 md5 read-back 證明等價） ──
CREATE OR REPLACE FUNCTION public.enqueue_institutional_backfill_universe()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n INT;
BEGIN
  WITH cov AS (
    SELECT stock_id, COUNT(DISTINCT trade_date) AS d
      FROM public.tw_institutional_daily
     GROUP BY stock_id
  ),
  saved AS (
    SELECT DISTINCT upper(btrim(COALESCE(h->>'code', h->>'symbol'))) AS sid
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
               WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
               ELSE '[]'::jsonb
             END
           ) h
     WHERE cs.key LIKE 'pf-holdings%'
  ),
  open_pos AS (
    SELECT DISTINCT sid FROM (
      SELECT SPLIT_PART(TRIM(tr.instrument), ' ', 1) AS sid
        FROM public.trade_records tr
       WHERE tr.market = 'TW' AND tr.status::text = 'open'
      UNION
      SELECT SPLIT_PART(TRIM(es.instrument), ' ', 1)
        FROM public.expert_signals es
       WHERE es.market = 'TW'
    ) x
  ),
  others AS (
    SELECT DISTINCT u.code AS sid
      FROM public.checkup_prefetch_universe() u
     WHERE u.supported
    UNION
    SELECT DISTINCT stock_id FROM public.v_active_tw_holdings
  ),
  r1 AS (SELECT sid FROM saved WHERE sid ~ '^[1-9][0-9]{3}$'),
  r2 AS (
    SELECT sid FROM open_pos
     WHERE sid ~ '^[1-9][0-9]{3}$'
       AND sid NOT IN (SELECT sid FROM r1)
  ),
  r3 AS (
    SELECT sid FROM others
     WHERE sid ~ '^[1-9][0-9]{3}$'
       AND sid NOT IN (SELECT sid FROM r1)
       AND sid NOT IN (SELECT sid FROM r2)
  ),
  elig AS (
    SELECT c.sid, c.rnk
      FROM (
        SELECT sid, 1 AS rnk FROM r1
        UNION ALL SELECT sid, 2 FROM r2
        UNION ALL SELECT sid, 3 FROM r3
      ) c
      LEFT JOIN cov ON cov.stock_id = c.sid
      LEFT JOIN public.institutional_new_stock_queue q ON q.stock_id = c.sid
     WHERE COALESCE(cov.d, 0) < 40
       AND (
         q.stock_id IS NULL
         OR (
           q.status IN ('failed', 'dead')
           AND q.attempts < 5
           AND q.next_attempt_at <= now()
           AND COALESCE(q.last_error, '') !~* '(no_data|delisted|ineligible|sealed|terminal)'
         )
       )
  ),
  cand AS (
        (SELECT sid FROM elig WHERE rnk = 1 ORDER BY sid LIMIT 20)
    UNION ALL
        (SELECT sid FROM elig WHERE rnk = 2 ORDER BY sid LIMIT 15)
    UNION ALL
        (SELECT sid FROM elig WHERE rnk = 3 ORDER BY sid LIMIT 5)
  ),
  ins AS (
    INSERT INTO public.institutional_new_stock_queue (stock_id, status, attempts, next_attempt_at)
    SELECT sid, 'pending', 0, now() FROM cand
    ON CONFLICT (stock_id) DO UPDATE
       SET status = 'pending',
           next_attempt_at = now() + LEAST(
             interval '24 hours',
             make_interval(mins => (30 * power(2, LEAST(public.institutional_new_stock_queue.attempts, 10)))::int)
           ),
           updated_at = now()
       WHERE public.institutional_new_stock_queue.status IN ('failed', 'dead')
         AND public.institutional_new_stock_queue.attempts < 5
         AND public.institutional_new_stock_queue.next_attempt_at <= now()
         AND COALESCE(public.institutional_new_stock_queue.last_error, '') !~* '(no_data|delisted|ineligible|sealed|terminal)'
    RETURNING 1
  )
  SELECT COUNT(*) INTO _n FROM ins;
  RETURN _n;
END;
$function$;

BEGIN;

DELETE FROM public.institutional_new_stock_queue;
DELETE FROM public.checkup_storage;
DELETE FROM public.trade_records;
DELETE FROM public.expert_signals;
DELETE FROM public.tw_institutional_daily;

-- rank1：30 檔已存檔持倉（跨 2 個 user，含 1 檔重複 code 以驗去重）
INSERT INTO public.checkup_storage (user_id, key, data)
VALUES ('11111111-1111-1111-1111-111111111111', 'pf-holdings-v2',
        (SELECT jsonb_agg(jsonb_build_object('code', (5000 + g)::text)) FROM generate_series(1, 30) g)),
       ('22222222-2222-2222-2222-222222222222', 'pf-holdings-v2',
        '[{"code":"5001"},{"symbol":"5002"}]'::jsonb);

-- rank2：20 檔未平倉部位（open trade_records）
INSERT INTO public.trade_records (id, expert_id, instrument, entry_price, entry_date, status, market)
SELECT gen_random_uuid(), gen_random_uuid(), (6000 + g)::text || ' TEST', 100, now(), 'open', 'TW'
  FROM generate_series(1, 20) g;

-- rank3：registry 冷門股（chips_prefetch_targets → checkup_prefetch_universe）
UPDATE public.chips_prefetch_targets SET active = false;
INSERT INTO public.chips_prefetch_targets (code, active, source, supported)
SELECT (7000 + g)::text, true, 'manual', true FROM generate_series(1, 20) g
ON CONFLICT (code) DO UPDATE SET active = true, supported = true;

DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.checkup_prefetch_universe() u
   WHERE u.supported AND u.code LIKE '7%';
  ASSERT c >= 20, format('seed: rank3 registry pool not supported (%s)', c);
END $$;

-- ── Case 1：contract 不變 ─────────────────────────────────
DO $$
DECLARE ret text; args text; sec boolean; cfg text[];
BEGIN
  SELECT pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig
    INTO ret, args, sec, cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_institutional_backfill_universe';
  ASSERT ret = 'integer', format('case1: return drift %s', ret);
  ASSERT args = '', format('case1: arg drift %s', args);
  ASSERT sec, 'case1: SECURITY DEFINER lost';
  ASSERT cfg @> ARRAY['search_path=public'], format('case1: search_path drift %s', cfg);
END $$;

-- ── Case 2：單輪配額 rank1<=20 / rank2<=15 / rank3<=5 ─────
DO $$
DECLARE n int; c1 int; c2 int; c3 int;
BEGIN
  SELECT public.enqueue_institutional_backfill_universe() INTO n;
  SELECT count(*) INTO c1 FROM public.institutional_new_stock_queue WHERE stock_id LIKE '5%';
  SELECT count(*) INTO c2 FROM public.institutional_new_stock_queue WHERE stock_id LIKE '6%';
  SELECT count(*) INTO c3 FROM public.institutional_new_stock_queue WHERE stock_id LIKE '7%';
  ASSERT c1 = 20, format('case2: rank1 quota expected 20 got %s', c1);
  ASSERT c2 = 15, format('case2: rank2 quota expected 15 got %s', c2);
  ASSERT c3 = 5,  format('case2: rank3 quota expected 5 got %s', c3);
  ASSERT n = 40, format('case2: total expected 40 got %s', n);
END $$;

-- ── Case 3：pending / running / done 不得被 UPDATE ────────
DO $$
DECLARE before_snap text; after_snap text; n int;
BEGIN
  UPDATE public.institutional_new_stock_queue SET status='running', next_attempt_at = now() - interval '10 days'
   WHERE stock_id = '5001';
  UPDATE public.institutional_new_stock_queue SET status='done'
   WHERE stock_id = '5002';
  UPDATE public.institutional_new_stock_queue SET next_attempt_at = now() - interval '1 day'
   WHERE stock_id = '5003';  -- pending 且已到期

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO before_snap
    FROM (SELECT stock_id||status||attempts||next_attempt_at||coalesce(last_error,'')||updated_at AS t
            FROM public.institutional_new_stock_queue
           WHERE stock_id IN ('5001','5002','5003')) s;

  SELECT public.enqueue_institutional_backfill_universe() INTO n;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO after_snap
    FROM (SELECT stock_id||status||attempts||next_attempt_at||coalesce(last_error,'')||updated_at AS t
            FROM public.institutional_new_stock_queue
           WHERE stock_id IN ('5001','5002','5003')) s;

  ASSERT before_snap = after_snap, 'case3: pending/running/done rows were modified';
END $$;

-- ── Case 4：terminal 列永不復活 ───────────────────────────
DO $$
DECLARE snap1 text; snap2 text; i int;
BEGIN
  UPDATE public.institutional_new_stock_queue
     SET status='dead', attempts=2, last_error='no_data: delisted', next_attempt_at = now() - interval '1 day'
   WHERE stock_id = '5004';
  UPDATE public.institutional_new_stock_queue
     SET status='dead', attempts=5, last_error='upstream 500', next_attempt_at = now() - interval '1 day'
   WHERE stock_id = '5005';

  SELECT md5(string_agg(t,'|' ORDER BY t)) INTO snap1
    FROM (SELECT stock_id||status||attempts||coalesce(last_error,'') AS t
            FROM public.institutional_new_stock_queue WHERE stock_id IN ('5004','5005')) s;

  FOR i IN 1..24 LOOP
    PERFORM public.enqueue_institutional_backfill_universe();
  END LOOP;

  SELECT md5(string_agg(t,'|' ORDER BY t)) INTO snap2
    FROM (SELECT stock_id||status||attempts||coalesce(last_error,'') AS t
            FROM public.institutional_new_stock_queue WHERE stock_id IN ('5004','5005')) s;

  ASSERT snap1 = snap2, 'case4: terminal rows were revived';
END $$;

-- ── Case 5：retryable 只在到期後重試、attempts 不歸零、last_error 不清空 ──
DO $$
DECLARE st text; att int; err text; nxt timestamptz; before_nxt timestamptz;
BEGIN
  UPDATE public.institutional_new_stock_queue
     SET status='dead', attempts=2, last_error='upstream timeout',
         next_attempt_at = now() + interval '3 hours'
   WHERE stock_id = '5006';
  before_nxt := (SELECT next_attempt_at FROM public.institutional_new_stock_queue WHERE stock_id='5006');

  PERFORM public.enqueue_institutional_backfill_universe();
  SELECT status, attempts, next_attempt_at INTO st, att, nxt
    FROM public.institutional_new_stock_queue WHERE stock_id='5006';
  ASSERT st = 'dead', format('case5: not-due row requeued (%s)', st);
  ASSERT nxt = before_nxt, 'case5: not-due row next_attempt_at changed';

  UPDATE public.institutional_new_stock_queue
     SET next_attempt_at = now() - interval '1 minute' WHERE stock_id='5006';
  PERFORM public.enqueue_institutional_backfill_universe();
  SELECT status, attempts, last_error, next_attempt_at INTO st, att, err, nxt
    FROM public.institutional_new_stock_queue WHERE stock_id='5006';
  ASSERT st = 'pending', format('case5: due retryable not requeued (%s)', st);
  ASSERT att = 2, format('case5: attempts reset (%s)', att);
  ASSERT err = 'upstream timeout', format('case5: last_error cleared (%s)', err);
  -- backoff：30min * 2^2 = 120 分鐘
  ASSERT nxt > now() + interval '110 minutes' AND nxt < now() + interval '130 minutes',
         format('case5: backoff drift %s', nxt);
END $$;

-- ── Case 6：24 輪 —— 永久失敗 rank1 不擋 rank2/3、rank3 持續推進 ──
DO $$
DECLARE i int; c3 int; c3_prev int; grew int := 0;
BEGIN
  -- 擴充 rank3 registry 池到 200 檔，rank1 全數置為 terminal
  INSERT INTO public.chips_prefetch_targets (code, active, source, supported)
  SELECT (7000 + g)::text, true, 'manual', true FROM generate_series(21, 200) g
  ON CONFLICT (code) DO UPDATE SET active = true, supported = true;

  UPDATE public.institutional_new_stock_queue
     SET status='dead', attempts=5, last_error='terminal: permanent'
   WHERE stock_id LIKE '5%';

  SELECT count(*) INTO c3_prev FROM public.institutional_new_stock_queue WHERE stock_id LIKE '7%';

  FOR i IN 1..24 LOOP
    -- 模擬 worker：把 pending 消化成 done，讓下一輪能取新目標
    UPDATE public.institutional_new_stock_queue SET status='done' WHERE status='pending';
    PERFORM public.enqueue_institutional_backfill_universe();
    SELECT count(*) INTO c3 FROM public.institutional_new_stock_queue WHERE stock_id LIKE '7%';
    IF c3 > c3_prev THEN grew := grew + 1; END IF;
    c3_prev := c3;
  END LOOP;

  ASSERT grew >= 8, format('case6: rank3 starved, grew in only %s of 24 rounds', grew);
  SELECT count(*) INTO c3 FROM public.institutional_new_stock_queue WHERE stock_id LIKE '7%';
  ASSERT c3 >= 40, format('case6: rank3 coverage too low: %s', c3);
END $$;

-- ── Case 7：持續新增 rank1 時 rank3 仍推進 ────────────────
DO $$
DECLARE i int; c3_before int; c3_after int;
BEGIN
  SELECT count(*) INTO c3_before FROM public.institutional_new_stock_queue WHERE stock_id LIKE '7%';
  INSERT INTO public.chips_prefetch_targets (code, active, source, supported)
  SELECT (7000 + g)::text, true, 'manual', true FROM generate_series(201, 300) g
  ON CONFLICT (code) DO UPDATE SET active = true, supported = true;

  FOR i IN 1..10 LOOP
    INSERT INTO public.checkup_storage (user_id, key, data)
    VALUES (gen_random_uuid(), 'pf-holdings-v2',
            (SELECT jsonb_agg(jsonb_build_object('code', (5100 + i*10 + g)::text))
               FROM generate_series(1, 10) g));
    UPDATE public.institutional_new_stock_queue SET status='done' WHERE status='pending';
    PERFORM public.enqueue_institutional_backfill_universe();
  END LOOP;

  SELECT count(*) INTO c3_after FROM public.institutional_new_stock_queue WHERE stock_id LIKE '7%';
  ASSERT c3_after > c3_before,
         format('case7: rank3 starved under rank1 pressure (%s -> %s)', c3_before, c3_after);
END $$;

-- ── Case 8：cov >= 40 不再入列 ────────────────────────────
DO $$
DECLARE n_before int; present boolean;
BEGIN
  DELETE FROM public.institutional_new_stock_queue WHERE stock_id = '5001';
  INSERT INTO public.tw_institutional_daily (stock_id, trade_date, foreign_net, trust_net, dealer_net, total_net)
  SELECT '5001', CURRENT_DATE - g, 0, 0, 0, 0 FROM generate_series(1, 45) g
  ON CONFLICT DO NOTHING;

  PERFORM public.enqueue_institutional_backfill_universe();
  SELECT EXISTS(SELECT 1 FROM public.institutional_new_stock_queue WHERE stock_id='5001') INTO present;
  ASSERT NOT present, 'case8: stock with cov>=40 was enqueued';
END $$;

ROLLBACK;

\echo 'institutional_fairness_backoff_test: ALL CASES PASS'
