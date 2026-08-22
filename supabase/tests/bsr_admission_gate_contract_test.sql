-- Stage 0 RED test — BSR admission gate RPC 契約（signature / security / search_path / ACL）
--
-- 事故背景（2026-08）：已部署的 `_shared/bsrAdmissionGate.ts` 呼叫
-- `public.bsr_admission_status()` 與 `public.bsr_block_and_terminalize_claims(...)`，
-- 但兩支都只存在於 clone 排練腳本，production 完全沒有 → worker 每次 fail-closed，
-- 回 HTTP 200 / claimed=0 / provider_calls=0，cron 全綠但零產出。
--
-- 本檔在 gate RPC 缺席時必須 RED；補上之後必須同時滿足：
--   * exact identity arguments
--   * SECURITY DEFINER
--   * proconfig 有固定 search_path
--   * service_role 有 EXECUTE，PUBLIC / anon / authenticated 一律沒有
--
-- 執行前置：apply 整個 supabase/migrations/ 目錄（filename 排序）。

\set ON_ERROR_STOP on
BEGIN;

-- ─────────────────────────────────────────────
-- Case 1：兩支 gate RPC 必須存在，且 identity arguments 精確相符
-- ─────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname = 'bsr_admission_status'
     AND pg_get_function_identity_arguments(p.oid) = '';
  ASSERT n = 1,
    format('case1: public.bsr_admission_status() missing or wrong signature (got %s) '
           '— deployed bsrAdmissionGate.ts 依賴它，缺席時 worker 永遠 rpc_error/claimed=0', n);

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname = 'bsr_block_and_terminalize_claims'
     AND pg_get_function_identity_arguments(p.oid)
         = 'uuid, bigint[], timestamp with time zone[], integer[], text, jsonb';
  ASSERT n = 1,
    format('case1: public.bsr_block_and_terminalize_claims(uuid,bigint[],timestamptz[],int[],text,jsonb) '
           'missing or wrong signature (got %s)', n);
END $$;

-- ─────────────────────────────────────────────
-- Case 2：SECURITY DEFINER + 固定 search_path
-- ─────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('bsr_admission_status', 'bsr_block_and_terminalize_claims')
  LOOP
    ASSERT r.prosecdef, format('case2: %s must be SECURITY DEFINER', r.proname);
    ASSERT r.proconfig IS NOT NULL
           AND EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%'),
      format('case2: %s must pin search_path (proconfig=%s)', r.proname, r.proconfig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- Case 3：ACL — service_role only，anon / authenticated / PUBLIC 不得 EXECUTE
-- ─────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('bsr_admission_status', 'bsr_block_and_terminalize_claims')
  LOOP
    ASSERT has_function_privilege('service_role', r.oid, 'EXECUTE'),
      format('case3: service_role must EXECUTE %s', r.proname);
    ASSERT NOT has_function_privilege('anon', r.oid, 'EXECUTE'),
      format('case3: anon must NOT EXECUTE %s', r.proname);
    ASSERT NOT has_function_privilege('authenticated', r.oid, 'EXECUTE'),
      format('case3: authenticated must NOT EXECUTE %s', r.proname);
    ASSERT NOT (coalesce(p.proacl::text, '') LIKE '%=X/%' AND coalesce(p.proacl::text,'') LIKE '% =X/%'),
      format('case3: %s must not grant EXECUTE to PUBLIC', r.proname)
      FROM pg_proc p WHERE p.oid = r.oid;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- Case 4：gate 不得建立在 tw_bsr_sync_queue 的寫入 trigger 上
--         （本輪明確排除 trg_tw_bsr_sync_queue_admission_gate，避免影響 cron 106 enqueue）
-- ─────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.tw_bsr_sync_queue'::regclass
     AND NOT t.tgisinternal
     AND t.tgname = 'trg_tw_bsr_sync_queue_admission_gate';
  ASSERT n = 0, 'case4: admission gate trigger 不在本輪範圍，不得出現在 tw_bsr_sync_queue';
END $$;

ROLLBACK;
