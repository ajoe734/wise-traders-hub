-- P7-B：enqueue_bsr_backfill 權限矩陣測試（admin → company_admin）
--
-- 執行：
--   bash scripts/ephemeral-pg.sh up-slice
--   bash scripts/ephemeral-pg.sh load-slice
--   bash scripts/ephemeral-pg.sh run-file supabase/tests/fixtures/bsr_e2e_schema.sql \
--        supabase/tests/fixtures/bsr_e2e_functions.sql \
--        supabase/tests/enqueue_bsr_backfill_authz_test.sql
--
-- 前提：fixture 已含 user_roles / has_role / enqueue_bsr_backfill / checkup_storage /
--       trade_records / experts / tw_bsr_sync_queue。

\set ON_ERROR_STOP on

-- ephemeral 無 GoTrue：以可覆寫的 auth.uid() stub 模擬登入者
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid;
$$;

-- ── 受測函式（與 P7-B migration 逐字相同，唯一差異：admin → company_admin） ──
CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(p_stock_id text, p_days integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_d date;
  v_inserted int := 0;
  v_count int := 0;
  v_row_ct int;
  v_max_days int := LEAST(GREATEST(p_days, 1), 120);
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RAISE EXCEPTION 'invalid stock_id (must be 4-digit code starting 1-9)';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT public.has_role(v_uid, 'company_admin') INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE (regexp_match(COALESCE(tr.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] = p_stock_id
        AND e.user_id = v_uid
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      -- 只看「自己」的持倉列；解析 array 與 {holdings:[]} 兩種形狀
      SELECT EXISTS (
        SELECT 1
          FROM public.checkup_storage cs,
               LATERAL jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
                   WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
                   ELSE '[]'::jsonb
                 END
               ) h
         WHERE cs.user_id = v_uid
           AND cs.key LIKE 'pf-holdings%'
           AND upper(btrim(COALESCE(h->>'code', h->>'symbol'))) = p_stock_id
      ) INTO v_is_owner;
    END IF;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'not authorized to backfill this stock';
    END IF;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < v_max_days LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES (p_stock_id, v_d, 1, 'pending', now(), 'backfill_rpc', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_row_ct = ROW_COUNT;
      v_inserted := v_inserted + v_row_ct;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 200;
  END LOOP;

  RETURN v_inserted;
END; $function$;

BEGIN;

-- ── Case 0：contract 不變 ─────────────────────────────────
DO $$
DECLARE ret text; args text; sec boolean; cfg text[];
BEGIN
  SELECT pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig
    INTO ret, args, sec, cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_bsr_backfill';
  ASSERT ret = 'integer', format('case0: return drift %s', ret);
  ASSERT args = 'p_stock_id text, p_days integer', format('case0: arg drift %s', args);
  ASSERT sec, 'case0: SECURITY DEFINER lost';
  ASSERT cfg @> ARRAY['search_path=public'], format('case0: search_path drift %s', cfg);
END $$;

-- seed
DELETE FROM public.tw_bsr_sync_queue;
DELETE FROM public.checkup_storage;
DELETE FROM public.user_roles;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'holder@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'stranger@test.local')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'company_admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.checkup_storage (user_id, key, data)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'pf-holdings-v2', '[{"code":"2330"}]'::jsonb)
ON CONFLICT (user_id, key) DO UPDATE SET data = EXCLUDED.data;

-- ── Case 1：anon（auth.uid() IS NULL）→ not authenticated ──
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('test.uid', '', true);
  BEGIN
    PERFORM public.enqueue_bsr_backfill('2330', 5);
  EXCEPTION WHEN others THEN
    ok := (SQLERRM LIKE '%not authenticated%');
  END;
  ASSERT ok, 'case1: anon must be rejected with not authenticated';
END $$;

-- ── Case 2：一般 user、非持有 → not authorized ────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM public.enqueue_bsr_backfill('2330', 5);
  EXCEPTION WHEN others THEN
    ok := (SQLERRM LIKE '%not authorized%');
  END;
  ASSERT ok, 'case2: non-owner must be rejected';
END $$;

-- ── Case 3：一般 user、持有該股 → 允許 ───────────────────
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000002', true);
  SELECT public.enqueue_bsr_backfill('2330', 5) INTO n;
  ASSERT n > 0, format('case3: owner enqueue produced %s rows', n);
END $$;

-- ── Case 4：company_admin → 允許任何股 ───────────────────
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  SELECT public.enqueue_bsr_backfill('2317', 5) INTO n;
  ASSERT n > 0, format('case4: company_admin enqueue produced %s rows', n);
END $$;

-- ── Case 5：非法 stock_id 一律拒絕（先於 auth 檢查） ─────
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM public.enqueue_bsr_backfill('ABC', 5);
  EXCEPTION WHEN others THEN
    ok := (SQLERRM LIKE '%invalid stock_id%');
  END;
  ASSERT ok, 'case5: invalid stock_id must be rejected';
END $$;

ROLLBACK;

\echo 'enqueue_bsr_backfill_authz_test: ALL CASES PASS'
