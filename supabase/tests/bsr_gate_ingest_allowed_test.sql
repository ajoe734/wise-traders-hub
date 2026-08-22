-- Stage 3B / S3B-0 RED test — private_bsr.ingest_allowed() 的單元契約
--
-- 這一檔只測 helper 本身（不測七支 producer 的行為，那是 bsr_ingest_suppression_test）。
-- 目前預期 RED，失敗點：private_bsr.ingest_allowed() 不存在（S3B-A 尚未套用）。
--
-- 契約（v4.1 §S3B-A）：
--   Case 1  函式存在，回傳 boolean，零參數
--   Case 2  SECURITY DEFINER + STABLE + 固定 search_path
--   Case 3  anon / authenticated / service_role / PUBLIC 全部沒有 EXECUTE
--   Case 4  gate 缺 row（legacy_config_missing）→ 允許 ingest（true），不得 fail-closed 誤殺
--   Case 5  gate row 存在但 admission_blocked=false → true
--   Case 6  gate row admission_blocked=true → false（這是 honest downgrade 的核心）
--   Case 7  gate config 損毀（型別不符 / 缺 admission_blocked）→ 視為未封鎖（true）並不得 raise
--
-- 隔離協定（v4.1）：BEGIN + SAVEPOINT fixture + 最終 ROLLBACK；前後比對
-- queue count/hash、queue max(updated_at)/max(enqueued_at)、config hash、audit_logs、
-- tw_bsr_degrade_events 全部 0 delta。gate row 一律用 fixture savepoint，
-- 不直接改 production 的 v7/v8 row。
--
-- 執行：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_gate_ingest_allowed_test.sql

\set ON_ERROR_STOP on
BEGIN;

\i supabase/tests/_s3b0_snapshot.sql
CALL s3b0_snapshot('before');

-- ─────────────────────────────────────────────
-- Case 1：函式存在、零參數、回傳 boolean
-- ─────────────────────────────────────────────
DO $$
DECLARE p record;
BEGIN
  SELECT pr.oid, pr.pronargs, pr.prorettype, pr.prosecdef, pr.provolatile, pr.proconfig
    INTO p
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
   WHERE ns.nspname = 'private_bsr' AND pr.proname = 'ingest_allowed';

  ASSERT p.oid IS NOT NULL,
    'case1: private_bsr.ingest_allowed() 不存在 —— S3B-A 尚未套用（預期 RED）';
  ASSERT p.pronargs = 0,
    format('case1: ingest_allowed 必須零參數，實得 %s 個', p.pronargs);
  ASSERT p.prorettype = 'boolean'::regtype,
    format('case1: ingest_allowed 必須回傳 boolean，實得 %s', p.prorettype::regtype);
END $$;

-- ─────────────────────────────────────────────
-- Case 2：SECURITY DEFINER + STABLE + 固定 search_path
-- ─────────────────────────────────────────────
DO $$
DECLARE p record;
BEGIN
  SELECT pr.prosecdef, pr.provolatile, pr.proconfig INTO p
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
   WHERE ns.nspname = 'private_bsr' AND pr.proname = 'ingest_allowed';
  ASSERT p IS NOT NULL,
    'case2: private_bsr.ingest_allowed() 不存在（預期 RED）';
  ASSERT p.prosecdef,
    'case2: ingest_allowed 必須 SECURITY DEFINER（producer 是 definer，helper 不能靠呼叫者權限）';
  ASSERT p.provolatile = 's',
    format('case2: ingest_allowed 必須 STABLE，實得 provolatile=%s', p.provolatile);
  ASSERT p.proconfig IS NOT NULL
         AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
    format('case2: ingest_allowed 必須固定 search_path（proconfig=%s）', p.proconfig);
END $$;

-- ─────────────────────────────────────────────
-- Case 3：前台角色與 PUBLIC 一律無 EXECUTE
-- ─────────────────────────────────────────────
DO $$
DECLARE fn oid; g text;
BEGIN
  SELECT pr.oid INTO fn
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
   WHERE ns.nspname = 'private_bsr' AND pr.proname = 'ingest_allowed';
  ASSERT fn IS NOT NULL, 'case3: private_bsr.ingest_allowed() 不存在（預期 RED）';

  FOREACH g IN ARRAY ARRAY['anon','authenticated','service_role','public'] LOOP
    CONTINUE WHEN g <> 'public' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g);
    ASSERT NOT has_function_privilege(g, fn, 'EXECUTE'),
      format('case3: %s 不得對 private_bsr.ingest_allowed() 有 EXECUTE', g);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- Case 4–7：gate 各狀態的回傳值（fixture 全部 savepoint 隔離）
-- ─────────────────────────────────────────────
SAVEPOINT fx_gate;

-- 先把 production 的 gate row 移開（僅在本 savepoint 內）
DELETE FROM public.tw_bsr_sync_config WHERE key = 'bsr_availability';

-- Case 4：缺 row
DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS TRUE,
    format('case4: gate row 缺席（legacy_config_missing）時必須允許 ingest，實得 %s', v);
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'case4: private_bsr.ingest_allowed() 不存在（預期 RED）';
END $$;

-- Case 5：未封鎖
INSERT INTO public.tw_bsr_sync_config (key, version, config, updated_at)
VALUES ('bsr_availability', 1, jsonb_build_object('admission_blocked', false), now());

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS TRUE, format('case5: admission_blocked=false 時必須為 true，實得 %s', v);
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'case5: private_bsr.ingest_allowed() 不存在（預期 RED）';
END $$;

-- Case 6：已封鎖
UPDATE public.tw_bsr_sync_config
   SET version = 2,
       config = jsonb_build_object(
         'admission_blocked', true,
         'admission_reason', 'provider_plan_rejected',
         'admission_terminal_code', 'bsr_provider_unsupported')
 WHERE key = 'bsr_availability';

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS FALSE, format('case6: admission_blocked=true 時必須為 false，實得 %s', v);
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'case6: private_bsr.ingest_allowed() 不存在（預期 RED）';
END $$;

-- Case 7：config 損毀不得 raise
UPDATE public.tw_bsr_sync_config
   SET version = 3, config = '{"admission_blocked":"yes-please"}'::jsonb
 WHERE key = 'bsr_availability';

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS TRUE,
    format('case7: config 型別損毀時必須視為未封鎖（true）且不 raise，實得 %s', v);
EXCEPTION
  WHEN undefined_function THEN
    RAISE EXCEPTION 'case7: private_bsr.ingest_allowed() 不存在（預期 RED）';
  WHEN invalid_text_representation OR datatype_mismatch THEN
    RAISE EXCEPTION 'case7: config 損毀時 ingest_allowed() 不得拋型別錯誤';
END $$;

ROLLBACK TO SAVEPOINT fx_gate;

-- ─────────────────────────────────────────────
-- 零殘留驗證
-- ─────────────────────────────────────────────
CALL s3b0_assert_no_residue();

ROLLBACK;
