-- Build 1f Stage A — claim_bsr_queue_jobs token slot 行為契約（EPHEMERAL DB ONLY）
--
-- production 永不執行本檔（連 rollback transaction 也不行）。
-- 由 scripts/bsr-claim-equivalence.sh 在 mktemp 隨機目錄的臨時 cluster 內驅動。
--
-- 用法：
--   psql ... -v ON_ERROR_STOP=1 -v tcase=t1 -f supabase/tests/bsr_claim_token_slot_test.sql
--   tcase ∈ {t1,t2,t3,t4,t5,t6,nc1,nc2,nc3}
--   t5 另需 -v trading={true|false}
--
-- 每個 case 都在自己的 transaction 內 seed + assert + ROLLBACK，互不汙染；
-- negative control（nc*）會刻意 RAISE，psql 以非零退出，交易同時 abort。

\set ON_ERROR_STOP on
\if :{?tcase}
\else
\set tcase 'none'
\endif
\if :{?trading}
\else
\set trading 'true'
\endif

-- ---------------------------------------------------------------------------
-- Guard：只准在臨時 cluster 執行
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
  IF current_setting('bsr.ephemeral', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'guard: bsr.ephemeral<>1（本檔僅限臨時 cluster）';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'guard: not a unix-socket-only cluster';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin','supabase_auth_admin','authenticator')) THEN
    RAISE EXCEPTION 'guard: production role fingerprint detected';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 共用 seed helper（只建在臨時 cluster，測試結束隨 cluster 銷毀）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._t_seed_reset() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM public.tw_bsr_sync_queue;
END
$fn$;

-- fixture A（T1/T2/nc1 共用）：1 個舊 token(id=8001) + 30 檔 normal
CREATE OR REPLACE FUNCTION public._t_seed_a() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM public._t_seed_reset();
  INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
  VALUES (8001, 'T8001', current_date, 3, 'pending', now() - interval '30 min', 'quota_recovery_token');
  INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
  SELECT 8100 + g, 'N' || g, current_date, 1, 'pending', now() - interval '5 min', NULL
  FROM generate_series(1, 30) g;
END
$fn$;

-- fixture NC2（nc2/nc3 專用）：2 個 distinct token，且排序上必落在所有 normal 之前
CREATE OR REPLACE FUNCTION public._t_seed_nc2() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM public._t_seed_reset();
  INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
  VALUES
    (9001, 'T9001', current_date, 1, 'pending', now() - interval '10 min', 'quota_recovery_token'),
    (9002, 'T9002', current_date, 1, 'pending', now() - interval '9 min',  'quota_recovery_token');
  INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
  SELECT 9100 + g, 'M' || g, current_date, 3, 'pending', now() - interval '1 min', NULL
  FROM generate_series(1, 10) g;
END
$fn$;

-- ===========================================================================
-- T1：只有 token → 回 1 筆且為 token
-- ===========================================================================
\if :{?tcase}
\endif

\set is_t1 false
\set is_t2 false
\set is_t3 false
\set is_t4 false
\set is_t5 false
\set is_t6 false
\set is_nc1 false
\set is_nc2 false
\set is_nc3 false
SELECT
  (:'tcase' = 't1')  AS is_t1, (:'tcase' = 't2') AS is_t2, (:'tcase' = 't3') AS is_t3,
  (:'tcase' = 't4')  AS is_t4, (:'tcase' = 't5') AS is_t5, (:'tcase' = 't6') AS is_t6,
  (:'tcase' = 'nc1') AS is_nc1, (:'tcase' = 'nc2') AS is_nc2, (:'tcase' = 'nc3') AS is_nc3,
  (:'trading' = 'true') AS is_trading
\gset

\if :is_t1
BEGIN;
SELECT public._t_seed_reset();
INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
VALUES (8001, 'T8001', current_date, 3, 'pending', now() - interval '30 min', 'quota_recovery_token');
DO $t1$
DECLARE n int; tok int;
BEGIN
  CREATE TEMP TABLE claimed ON COMMIT DROP AS SELECT * FROM public.claim_bsr_queue_jobs(20, 3);
  SELECT count(*) INTO n FROM claimed;
  SELECT count(*) INTO tok FROM claimed WHERE last_error = 'quota_recovery_token';
  IF n <> 1 THEN RAISE EXCEPTION 'T1 FAIL: expected 1 row, got %', n; END IF;
  IF tok <> 1 THEN RAISE EXCEPTION 'T1 FAIL: expected token row, got % token(s)', tok; END IF;
  RAISE NOTICE 'T1 PASS (rows=%, token=%)', n, tok;
END
$t1$;
ROLLBACK;
\endif

-- ===========================================================================
-- T2：1 token + 30 normal，_batch=20 → 恰 1 token + 19 normal，第一列為 token
-- ===========================================================================
\if :is_t2
BEGIN;
SELECT public._t_seed_a();
DO $t2$
DECLARE n int; tok int; first_id bigint;
BEGIN
  CREATE TEMP TABLE claimed ON COMMIT DROP AS
    SELECT row_number() OVER () AS rn, * FROM public.claim_bsr_queue_jobs(20, 3);
  SELECT count(*) INTO n FROM claimed;
  SELECT count(*) INTO tok FROM claimed WHERE last_error = 'quota_recovery_token';
  SELECT id INTO first_id FROM claimed WHERE rn = 1;
  IF n <> 20 THEN RAISE EXCEPTION 'T2 FAIL: expected 20 rows, got %', n; END IF;
  IF tok <> 1 THEN RAISE EXCEPTION 'T2 FAIL: expected exactly 1 token, got %', tok; END IF;
  IF first_id <> 8001 THEN RAISE EXCEPTION 'T2 FAIL: first row must be token 8001, got %', first_id; END IF;
  RAISE NOTICE 'T2 PASS (rows=%, token=%, first=%)', n, tok, first_id;
END
$t2$;
ROLLBACK;
\endif

-- ===========================================================================
-- T3：無 token → 與 pre 版行為一致（同一 fixture、同一批 id 與順序）
-- ===========================================================================
\if :is_t3
BEGIN;
-- pre 版（production 現況）以不同名字建立，只在此 transaction 內存在
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs_pre(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
RETURNS SETOF tw_bsr_sync_queue LANGUAGE plpgsql SET search_path TO 'public'
AS $pre$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending'
      AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
    ORDER BY priority ASC, next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT _batch
  )
  UPDATE public.tw_bsr_sync_queue q
  SET status = 'running', started_at = now(), attempts = q.attempts + 1
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END; $pre$;

DO $t3$
DECLARE a bigint[]; b bigint[];
BEGIN
  PERFORM public._t_seed_reset();
  INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
  SELECT 8100 + g, 'N' || g, current_date, ((g % 3) + 1)::smallint, 'pending', now() - (g || ' min')::interval, NULL
  FROM generate_series(1, 30) g;
  SELECT array_agg(id ORDER BY ord) INTO a
    FROM (SELECT id, row_number() OVER () AS ord FROM public.claim_bsr_queue_jobs_pre(20, 3)) s;

  -- 還原 fixture 後跑新版
  PERFORM public._t_seed_reset();
  INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
  SELECT 8100 + g, 'N' || g, current_date, ((g % 3) + 1)::smallint, 'pending', now() - (g || ' min')::interval, NULL
  FROM generate_series(1, 30) g;
  SELECT array_agg(id ORDER BY ord) INTO b
    FROM (SELECT id, row_number() OVER () AS ord FROM public.claim_bsr_queue_jobs(20, 3)) s;

  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'T3 FAIL: token-free behaviour drifted. pre=% post=%', a, b;
  END IF;
  RAISE NOTICE 'T3 PASS (identical order, n=%)', array_length(b, 1);
END
$t3$;
ROLLBACK;
\endif

-- ===========================================================================
-- T4：另一 session 已鎖住 token 列 → SKIP LOCKED，本 session 不得再拿到同一 token
--     （harness 先開持鎖 session，再跑本 case）
-- ===========================================================================
\if :is_t4
DO $t4$
DECLARE n int; tok int;
BEGIN
  CREATE TEMP TABLE claimed_t4 ON COMMIT DROP AS SELECT * FROM public.claim_bsr_queue_jobs(20, 3);
  SELECT count(*) INTO n FROM claimed_t4;
  SELECT count(*) INTO tok FROM claimed_t4 WHERE id = 8001;
  IF tok <> 0 THEN RAISE EXCEPTION 'T4 FAIL: locked token 8001 was claimed twice'; END IF;
  IF n = 0 THEN RAISE EXCEPTION 'T4 FAIL: normal jobs starved while token locked'; END IF;
  RAISE NOTICE 'T4 PASS (rows=%, locked token skipped)', n;
END
$t4$;
\endif

-- ===========================================================================
-- T5：is_tw_trading_hours 兩支 branch（harness 各跑一次，counter 在 shell 層）
-- ===========================================================================
\if :is_t5
BEGIN;
-- psql 變數不會進入 dollar-quoted body，故兩支 branch 各寫一次常數定義
\if :is_trading
CREATE OR REPLACE FUNCTION public.is_tw_trading_hours() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $ih$ SELECT true $ih$;
\else
CREATE OR REPLACE FUNCTION public.is_tw_trading_hours() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $ih$ SELECT false $ih$;
\endif
SELECT public._t_seed_reset();
-- 一個 post_close_only token + 一個非 post_close_only normal
INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error, post_close_only)
VALUES
  (8001, 'T8001', current_date, 3, 'pending', now() - interval '30 min', 'quota_recovery_token', true),
  (8101, 'N1',    current_date, 1, 'pending', now() - interval '5 min',  NULL, false);
DO $t5$
DECLARE in_hours boolean; tok int; n int;
BEGIN
  SELECT public.is_tw_trading_hours() INTO in_hours;
  CREATE TEMP TABLE claimed_t5 ON COMMIT DROP AS SELECT * FROM public.claim_bsr_queue_jobs(20, 3);
  SELECT count(*) INTO n FROM claimed_t5;
  SELECT count(*) INTO tok FROM claimed_t5 WHERE id = 8001;
  IF in_hours THEN
    IF tok <> 0 THEN RAISE EXCEPTION 'T5(in_hours) FAIL: post_close_only token claimed during trading hours'; END IF;
    IF n <> 1 THEN RAISE EXCEPTION 'T5(in_hours) FAIL: expected only the normal job, got %', n; END IF;
    RAISE NOTICE 'T5 BRANCH=in_hours PASS (rows=%)', n;
  ELSE
    IF tok <> 1 THEN RAISE EXCEPTION 'T5(off_hours) FAIL: post_close_only token not claimed off hours'; END IF;
    IF n <> 2 THEN RAISE EXCEPTION 'T5(off_hours) FAIL: expected 2 rows, got %', n; END IF;
    RAISE NOTICE 'T5 BRANCH=off_hours PASS (rows=%)', n;
  END IF;
END
$t5$;
ROLLBACK;
\endif

-- ===========================================================================
-- T6：token 政策 = 最老 token（next_run_at ASC, id ASC），不看 priority
-- ===========================================================================
\if :is_t6
BEGIN;
SELECT public._t_seed_reset();
INSERT INTO public.tw_bsr_sync_queue (id, stock_id, trade_date, priority, status, next_run_at, last_error)
VALUES
  (9001, 'T9001', current_date, 3, 'pending', now() - interval '30 min', 'quota_recovery_token'), -- 較老、priority 較大
  (9002, 'T9002', current_date, 1, 'pending', now() - interval '5 min',  'quota_recovery_token'); -- 較新、priority 較小
DO $t6$
DECLARE picked_id bigint; tok int;
BEGIN
  CREATE TEMP TABLE claimed_t6 ON COMMIT DROP AS SELECT * FROM public.claim_bsr_queue_jobs(20, 3);
  SELECT count(*) INTO tok FROM claimed_t6 WHERE last_error = 'quota_recovery_token';
  SELECT id INTO picked_id FROM claimed_t6 WHERE last_error = 'quota_recovery_token' LIMIT 1;
  IF tok <> 1 THEN RAISE EXCEPTION 'T6 FAIL: expected exactly 1 token, got %', tok; END IF;
  IF picked_id <> 9001 THEN RAISE EXCEPTION 'T6 FAIL: oldest-token policy drifted, picked %', picked_id; END IF;
  RAISE NOTICE 'T6 PASS (oldest token 9001 picked)';
END
$t6$;
ROLLBACK;
\endif

-- ===========================================================================
-- NC1（deterministic negative control）：final ORDER BY p.bucket DESC
--   固定 fixture A 下第一列必為 normal → assert first_is_token 必然 FAIL
-- ===========================================================================
\if :is_nc1
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
RETURNS SETOF tw_bsr_sync_queue LANGUAGE plpgsql SET search_path TO 'public'
AS $nc1$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH token_slot AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error = 'quota_recovery_token'
    ORDER BY next_run_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT LEAST(1, GREATEST(_batch, 0))
  ),
  normal AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error IS DISTINCT FROM 'quota_recovery_token'
    ORDER BY priority ASC, next_run_at ASC, id ASC FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(_batch - (SELECT count(*) FROM token_slot), 0)
  ),
  picked AS (SELECT id, 0 AS bucket FROM token_slot UNION ALL SELECT id, 1 AS bucket FROM normal),
  updated AS (
    UPDATE public.tw_bsr_sync_queue q SET status='running', started_at=now(), attempts=q.attempts+1
    FROM picked WHERE q.id = picked.id RETURNING q.*
  )
  SELECT u.* FROM updated u JOIN picked p ON p.id = u.id
  ORDER BY p.bucket DESC, u.priority ASC, u.next_run_at ASC, u.id ASC;
END; $nc1$;
SELECT public._t_seed_a();
DO $nc1a$
DECLARE first_id bigint;
BEGIN
  CREATE TEMP TABLE claimed_nc1 ON COMMIT DROP AS
    SELECT row_number() OVER () AS rn, * FROM public.claim_bsr_queue_jobs(20, 3);
  SELECT id INTO first_id FROM claimed_nc1 WHERE rn = 1;
  IF first_id <> 8001 THEN
    RAISE EXCEPTION 'NC1 EXPECTED-FAIL: first row must be token 8001, got % (bucket DESC detected)', first_id;
  END IF;
  RAISE EXCEPTION 'NC1 HARNESS BROKEN: mutation did not change first row';
END
$nc1a$;
ROLLBACK;
\endif

-- ===========================================================================
-- NC2：normal CTE 未排除 token → 回傳 2 個 distinct token id → token_count=1 必然 FAIL
-- ===========================================================================
\if :is_nc2
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
RETURNS SETOF tw_bsr_sync_queue LANGUAGE plpgsql SET search_path TO 'public'
AS $nc2$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH token_slot AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error = 'quota_recovery_token'
    ORDER BY next_run_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT LEAST(1, GREATEST(_batch, 0))
  ),
  normal AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND id NOT IN (SELECT id FROM token_slot)  -- 只避開重複 id，未排除「其他 token」
    ORDER BY priority ASC, next_run_at ASC, id ASC FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(_batch - (SELECT count(*) FROM token_slot), 0)
  ),
  picked AS (SELECT id, 0 AS bucket FROM token_slot UNION ALL SELECT id, 1 AS bucket FROM normal),
  updated AS (
    UPDATE public.tw_bsr_sync_queue q SET status='running', started_at=now(), attempts=q.attempts+1
    FROM picked WHERE q.id = picked.id RETURNING q.*
  )
  SELECT u.* FROM updated u JOIN picked p ON p.id = u.id
  ORDER BY p.bucket ASC, u.priority ASC, u.next_run_at ASC, u.id ASC;
END; $nc2$;
SELECT public._t_seed_nc2();
DO $nc2a$
DECLARE tok int;
BEGIN
  CREATE TEMP TABLE claimed_nc2 ON COMMIT DROP AS SELECT * FROM public.claim_bsr_queue_jobs(5, 3);
  SELECT count(DISTINCT id) INTO tok FROM claimed_nc2 WHERE last_error = 'quota_recovery_token';
  IF tok <> 1 THEN
    RAISE EXCEPTION 'NC2 EXPECTED-FAIL: expected exactly 1 token, got % distinct tokens', tok;
  END IF;
  RAISE EXCEPTION 'NC2 HARNESS BROKEN: mutation did not leak extra tokens';
END
$nc2a$;
ROLLBACK;
\endif

-- ===========================================================================
-- NC3：token_slot LIMIT 2 → 回傳 2 個 distinct token → token_count=1 必然 FAIL
-- ===========================================================================
\if :is_nc3
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
RETURNS SETOF tw_bsr_sync_queue LANGUAGE plpgsql SET search_path TO 'public'
AS $nc3$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH token_slot AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error = 'quota_recovery_token'
    ORDER BY next_run_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 2
  ),
  normal AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error IS DISTINCT FROM 'quota_recovery_token'
    ORDER BY priority ASC, next_run_at ASC, id ASC FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(_batch - (SELECT count(*) FROM token_slot), 0)
  ),
  picked AS (SELECT id, 0 AS bucket FROM token_slot UNION ALL SELECT id, 1 AS bucket FROM normal),
  updated AS (
    UPDATE public.tw_bsr_sync_queue q SET status='running', started_at=now(), attempts=q.attempts+1
    FROM picked WHERE q.id = picked.id RETURNING q.*
  )
  SELECT u.* FROM updated u JOIN picked p ON p.id = u.id
  ORDER BY p.bucket ASC, u.priority ASC, u.next_run_at ASC, u.id ASC;
END; $nc3$;
SELECT public._t_seed_nc2();
DO $nc3a$
DECLARE tok int;
BEGIN
  CREATE TEMP TABLE claimed_nc3 ON COMMIT DROP AS SELECT * FROM public.claim_bsr_queue_jobs(5, 3);
  SELECT count(DISTINCT id) INTO tok FROM claimed_nc3 WHERE last_error = 'quota_recovery_token';
  IF tok <> 1 THEN
    RAISE EXCEPTION 'NC3 EXPECTED-FAIL: expected exactly 1 token, got % distinct tokens', tok;
  END IF;
  RAISE EXCEPTION 'NC3 HARNESS BROKEN: LIMIT 2 did not yield 2 tokens';
END
$nc3a$;
ROLLBACK;
\endif
