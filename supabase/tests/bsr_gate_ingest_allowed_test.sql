-- Stage 3B / S3B-0 RED test — private_bsr.ingest_allowed() 的單元契約（fail-closed）
--
-- 這一檔只測 helper 本身（producer 行為在 bsr_ingest_suppression_test）。
-- 目前預期 RED，失敗點：private_bsr.ingest_allowed() 不存在（S3B-A 尚未套用）。
--
-- 【契約更正 2026-08-22】舊版 case4/case7 寫成 default-allow，與 Stage 1
-- private_bsr.gate_classify() 的 fail-closed 契約與 v4.1 §S3B-A 相反，會在
-- gate row 缺席或 config 損毀時重新放大 queue/provider call。本版一律 fail-closed：
--
--   Case 1  函式存在、零參數、回傳 boolean
--   Case 2  SECURITY DEFINER + STABLE + 固定 search_path
--   Case 3  anon / authenticated / service_role / PUBLIC 全部沒有 EXECUTE
--   Case 4  gate row 缺席（legacy_config_missing）→ FALSE（fail-closed，0 enqueue）
--   Case 5  gate row 存在且 admission_blocked = JSON false（canonical valid）→ TRUE
--   Case 6  admission_blocked = JSON true → FALSE
--   Case 7  malformed：admission_blocked 型別不符 → FALSE 且不拋錯
--   Case 8  malformed：admission_blocked 鍵缺席 → FALSE 且不拋錯
--   Case 9  malformed：config 非 object（JSON scalar / null）→ FALSE 且不拋錯
--   （4 + 5 + 6 + 7/8/9 三種 malformed 分支＝七個 gate-state 斷言）
--
-- 沒有任何 default-allow 路徑：只有 case5 的 canonical `false` 會回 true。
--
-- Harness：`-v stub=1` 會在交易內安裝參考實作 stub（委派 gate_classify），
-- 用來證明 case1..9 在 helper 存在時能逐 case 執行；stub 於 ROLLBACK 後不留存。
-- 不帶 stub 時 case1 即 RED（helper missing）。
--
-- 隔離協定（v4.1）：BEGIN + SAVEPOINT fixture + 最終 ROLLBACK；前後比對
-- queue count/hash、queue max(updated_at)/max(enqueued_at)、config hash、audit_logs、
-- tw_bsr_degrade_events 全部 0 delta。
--
-- 執行（RED）：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_gate_ingest_allowed_test.sql
-- 執行（stub 全 case PASS）：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -v stub=1 -f 同檔

\set ON_ERROR_STOP on
\if :{?stub}
\else
  \set stub 0
\endif

BEGIN;

\i supabase/tests/_s3b0_snapshot.sql
CALL s3b0_snapshot('before');

-- ─────────────────────────────────────────────
-- Harness：可選的參考實作 stub（僅存在於本交易）
-- ─────────────────────────────────────────────
SAVEPOINT fx_stub;
\if :stub
CREATE FUNCTION private_bsr.ingest_allowed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $stub$
DECLARE s jsonb; k jsonb;
BEGIN
  s := private_bsr.gate_state();
  IF s IS NULL THEN
    RETURN false;                         -- gate row 缺席 → fail-closed
  END IF;
  k := private_bsr.gate_classify(true, s -> 'config');
  RETURN NOT COALESCE((k ->> 'blocked')::boolean, true);
EXCEPTION WHEN OTHERS THEN
  RETURN false;                           -- 任何不可分類狀態 → fail-closed，不拋錯
END $stub$;
REVOKE ALL ON FUNCTION private_bsr.ingest_allowed() FROM PUBLIC;
\endif

-- ─────────────────────────────────────────────
-- Case 1：函式存在、零參數、回傳 boolean
-- ─────────────────────────────────────────────
DO $$
DECLARE p record;
BEGIN
  SELECT pr.oid, pr.pronargs, pr.prorettype INTO p
    FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
   WHERE ns.nspname = 'private_bsr' AND pr.proname = 'ingest_allowed';

  ASSERT p.oid IS NOT NULL,
    'case1: private_bsr.ingest_allowed() 不存在 —— S3B-A 尚未套用（預期 RED）';
  ASSERT p.pronargs = 0,
    format('case1: ingest_allowed 必須零參數，實得 %s 個', p.pronargs);
  ASSERT p.prorettype = 'boolean'::regtype,
    format('case1: ingest_allowed 必須回傳 boolean，實得 %s', p.prorettype::regtype);
  RAISE NOTICE 'case1 PASS: ingest_allowed() 存在、0 參數、回傳 boolean';
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
  ASSERT p IS NOT NULL, 'case2: private_bsr.ingest_allowed() 不存在（預期 RED）';
  ASSERT p.prosecdef,
    'case2: ingest_allowed 必須 SECURITY DEFINER';
  ASSERT p.provolatile = 's',
    format('case2: ingest_allowed 必須 STABLE，實得 provolatile=%s', p.provolatile);
  ASSERT p.proconfig IS NOT NULL
         AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
    format('case2: ingest_allowed 必須固定 search_path（proconfig=%s）', p.proconfig);
  RAISE NOTICE 'case2 PASS: SECURITY DEFINER + STABLE + 固定 search_path';
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
  RAISE NOTICE 'case3 PASS: anon/authenticated/service_role/PUBLIC 皆無 EXECUTE';
END $$;

-- ─────────────────────────────────────────────
-- Case 4–9：gate 各狀態的回傳值（fixture 全部 savepoint 隔離）
-- gate key 與 Stage 1 private_bsr.gate_state() 一致 = 'market_batch'
-- ─────────────────────────────────────────────
SAVEPOINT fx_gate;

DELETE FROM public.tw_bsr_sync_config WHERE key = 'market_batch';

-- Case 4：gate row 缺席 → fail-closed FALSE
DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS FALSE,
    format('case4: gate row 缺席（legacy_config_missing）必須 fail-closed=false，實得 %s', v);
  RAISE NOTICE 'case4 PASS: gate row 缺席 → false（0 enqueue）';
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'case4: private_bsr.ingest_allowed() 不存在（預期 RED）';
END $$;

-- Case 5：canonical valid，未封鎖 → TRUE（唯一允許路徑）
INSERT INTO public.tw_bsr_sync_config (key, version, config, updated_at)
VALUES ('market_batch', 1, jsonb_build_object('admission_blocked', false), now());

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS TRUE, format('case5: admission_blocked=false（canonical）必須為 true，實得 %s', v);
  RAISE NOTICE 'case5 PASS: admission_blocked=false → true';
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'case5: private_bsr.ingest_allowed() 不存在（預期 RED）';
END $$;

-- Case 6：已封鎖 → FALSE
UPDATE public.tw_bsr_sync_config
   SET version = 2,
       config = jsonb_build_object(
         'admission_blocked', true,
         'admission_reason', 'provider_plan_rejected',
         'admission_terminal_code', 'finmind_admission_provider_plan_rejected')
 WHERE key = 'market_batch';

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS FALSE, format('case6: admission_blocked=true 必須為 false，實得 %s', v);
  RAISE NOTICE 'case6 PASS: admission_blocked=true → false';
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION 'case6: private_bsr.ingest_allowed() 不存在（預期 RED）';
END $$;

-- Case 7：malformed（型別不符）→ FALSE 且不拋錯
UPDATE public.tw_bsr_sync_config
   SET version = 3, config = '{"admission_blocked":"yes-please"}'::jsonb
 WHERE key = 'market_batch';

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS FALSE,
    format('case7: admission_blocked 型別不符必須 fail-closed=false，實得 %s', v);
  RAISE NOTICE 'case7 PASS: type-invalid → false（未拋錯）';
EXCEPTION
  WHEN undefined_function THEN
    RAISE EXCEPTION 'case7: private_bsr.ingest_allowed() 不存在（預期 RED）';
  WHEN invalid_text_representation OR datatype_mismatch THEN
    RAISE EXCEPTION 'case7: config 損毀時 ingest_allowed() 不得拋型別錯誤';
END $$;

-- Case 8：malformed（鍵缺席）→ FALSE 且不拋錯
UPDATE public.tw_bsr_sync_config
   SET version = 4, config = '{"note":"no admission_blocked key"}'::jsonb
 WHERE key = 'market_batch';

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS FALSE,
    format('case8: admission_blocked 鍵缺席必須 fail-closed=false，實得 %s', v);
  RAISE NOTICE 'case8 PASS: key-missing → false（未拋錯）';
EXCEPTION
  WHEN undefined_function THEN
    RAISE EXCEPTION 'case8: private_bsr.ingest_allowed() 不存在（預期 RED）';
  WHEN invalid_text_representation OR datatype_mismatch THEN
    RAISE EXCEPTION 'case8: 鍵缺席時 ingest_allowed() 不得拋型別錯誤';
END $$;

-- Case 9：malformed（config 非 object）→ FALSE 且不拋錯
UPDATE public.tw_bsr_sync_config
   SET version = 5, config = '"blocked?"'::jsonb
 WHERE key = 'market_batch';

DO $$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT private_bsr.ingest_allowed()' INTO v;
  ASSERT v IS FALSE,
    format('case9: config 非 object 必須 fail-closed=false，實得 %s', v);
  RAISE NOTICE 'case9 PASS: config-not-object → false（未拋錯）';
EXCEPTION
  WHEN undefined_function THEN
    RAISE EXCEPTION 'case9: private_bsr.ingest_allowed() 不存在（預期 RED）';
  WHEN invalid_text_representation OR datatype_mismatch THEN
    RAISE EXCEPTION 'case9: config 非 object 時 ingest_allowed() 不得拋型別錯誤';
END $$;

ROLLBACK TO SAVEPOINT fx_gate;

-- ─────────────────────────────────────────────
-- Stub 拆除證明：DROP 後 targeted RED 必須回到「helper missing」
-- ─────────────────────────────────────────────
\if :stub
DROP FUNCTION private_bsr.ingest_allowed();
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
     WHERE ns.nspname = 'private_bsr' AND pr.proname = 'ingest_allowed'),
    'stub teardown: ingest_allowed 仍存在，harness 汙染';
  RAISE NOTICE 'stub teardown PASS: helper 已移除，targeted RED 回到 helper-missing';
END $$;
\endif

-- ─────────────────────────────────────────────
-- 零殘留驗證
-- ─────────────────────────────────────────────
CALL s3b0_assert_no_residue();

ROLLBACK;
