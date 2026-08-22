-- =====================================================================
-- Stage 1 — BSR admission gate：補回 deployed edge function 可達且必要的 RPC
--
-- 事故：Stage B 版 `tw-bsr-finmind-sync` / `admin-bsr-admission` 已部署，但
-- 對應 SQL 只在 clone 排練過（db/r1/c/SB/001_stage_b.sql），從未進 migrations。
-- 每次 worker 都在 `bsr_admission_status()` 就 rpc_error fail-closed，
-- HTTP 200 / claimed=0，cron 全綠但背景回補零產出。
--
-- 本 migration 只補「現行可達且必要」的物件（call-site matrix 見
-- docs/bsr/stage1-call-site-matrix.md）：
--   private_bsr.gate_state()            ← bsr_admission_status 相依
--   private_bsr.gate_classify()         ← 三支 wrapper 共同相依
--   private_bsr.assert_sanitized()      ← 兩支 write wrapper 相依
--   public.bsr_admission_status()                 ← _shared/bsrAdmissionGate.ts:156
--   public.bsr_block_and_terminalize_claims(...)  ← _shared/bsrAdmissionGate.ts:303
--   public.bsr_unblock_after_probe(...)           ← admin-bsr-admission/index.ts:119
--
-- 明確排除（無呼叫端／本輪不做）：
--   private_bsr.gate_blocked()、private_bsr.gate_explicit_open()
--   public.tw_bsr_sync_queue_admission_gate() 與 trg_tw_bsr_sync_queue_admission_gate
--
-- 不改：queue rows/status、RLS、cron、任何既有函式 ACL、任何資料。
-- 全部 schema-qualified、SECURITY DEFINER 逐支說明、search_path 固定。
--
-- ---------------------------------------------------------------------
-- EXACT INVERSE ROLLBACK（逐字執行即可回到套用前狀態）：
--   DROP FUNCTION IF EXISTS public.bsr_unblock_after_probe(int, text, jsonb, uuid);
--   DROP FUNCTION IF EXISTS public.bsr_block_and_terminalize_claims(
--     uuid, bigint[], timestamptz[], int[], text, jsonb);
--   DROP FUNCTION IF EXISTS public.bsr_admission_status();
--   DROP FUNCTION IF EXISTS private_bsr.assert_sanitized(jsonb, int);
--   DROP FUNCTION IF EXISTS private_bsr.gate_classify(boolean, jsonb);
--   DROP FUNCTION IF EXISTS private_bsr.gate_state();
--   DROP SCHEMA IF EXISTS private_bsr;   -- 套用前 production 該 schema 不存在
-- （rollback 不觸及任何資料列；閘門本來就沒有被開啟過。）
-- =====================================================================

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ---------------------------------------------------------------- schema
-- private_bsr 刻意不 GRANT 給 anon / authenticated / service_role：
-- 它永遠不透過 PostgREST 可達，唯一入口是下方三支 public wrapper。
CREATE SCHEMA IF NOT EXISTS private_bsr;
REVOKE ALL ON SCHEMA private_bsr FROM PUBLIC;

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER 理由：呼叫端 service_role 不具 private_bsr 權限，
-- 而 gate 狀態必須以固定身分讀取，避免呼叫端自帶 search_path 或權限差異。
CREATE OR REPLACE FUNCTION private_bsr.gate_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
  SELECT jsonb_build_object(
           'exists', (c.key IS NOT NULL),
           'version', c.version,
           'config', c.config)
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch'
$$;

-- fail-closed 契約：gate 只有在 market_batch 存在、config 是 object、
-- 且 admission_blocked 恰為 JSON false 時才算 OPEN。
-- 列缺、鍵缺、null、字串/數字/物件、非 object config 一律 blocked=true 並帶可觀察 reason。
-- 純函式、不碰任何表 → 不需要 SECURITY DEFINER（維持 INVOKER 最小權限）。
CREATE OR REPLACE FUNCTION private_bsr.gate_classify(p_exists boolean, p_cfg jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN COALESCE(p_exists, false) IS NOT TRUE
      THEN jsonb_build_object('blocked', true, 'reason', 'legacy_config_missing',
                              'detail', 'gate_row_missing')
    WHEN p_cfg IS NULL OR jsonb_typeof(p_cfg) <> 'object'
      THEN jsonb_build_object('blocked', true, 'reason', 'malformed',
                              'detail', 'config_not_object:' || COALESCE(jsonb_typeof(p_cfg),'null'))
    WHEN (p_cfg -> 'admission_blocked') IS NULL
      THEN jsonb_build_object('blocked', true, 'reason', 'legacy_config_missing',
                              'detail', 'admission_blocked_key_missing')
    WHEN jsonb_typeof(p_cfg -> 'admission_blocked') <> 'boolean'
      THEN jsonb_build_object('blocked', true, 'reason', 'malformed',
                              'detail', 'admission_blocked_not_boolean:' ||
                                        jsonb_typeof(p_cfg -> 'admission_blocked'))
    WHEN (p_cfg -> 'admission_blocked') = 'true'::jsonb
      THEN jsonb_build_object('blocked', true,
                              'reason', COALESCE(p_cfg ->> 'admission_reason', 'blocked'),
                              'detail', NULL)
    ELSE jsonb_build_object('blocked', false, 'reason', NULL, 'detail', NULL)
  END
$$;

-- evidence 遞迴 key denylist：raw 上游 body / token / url 永遠落不了地。
-- SECURITY DEFINER 理由：與 write wrapper 同身分執行，確保不能被呼叫端以較低權限
-- 的同名物件或 search_path 置換掉這道檢查。
CREATE OR REPLACE FUNCTION private_bsr.assert_sanitized(p jsonb, p_depth int DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
DECLARE k text; v jsonb;
BEGIN
  IF p IS NULL THEN RETURN; END IF;
  IF p_depth > 6 THEN RAISE EXCEPTION 'evidence_too_deep'; END IF;
  IF jsonb_typeof(p) = 'object' THEN
    FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
      IF lower(k) ~ '(token|url|authorization|cookie|api[_-]?key|secret|password|bearer|body|raw)' THEN
        RAISE EXCEPTION 'evidence_key_forbidden: %', k;
      END IF;
      PERFORM private_bsr.assert_sanitized(v, p_depth + 1);
    END LOOP;
  ELSIF jsonb_typeof(p) = 'array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(p) LOOP
      PERFORM private_bsr.assert_sanitized(v, p_depth + 1);
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------- wrapper 1: status（唯讀）
-- SECURITY DEFINER 理由：呼叫端 service_role 對 private_bsr 無權限；
-- 本函式只讀 gate 狀態、不寫任何表，且不接受任何參數（無注入面）。
CREATE OR REPLACE FUNCTION public.bsr_admission_status()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
DECLARE s jsonb; c jsonb; k jsonb;
BEGIN
  s := private_bsr.gate_state();
  IF s IS NULL THEN
    -- 列不存在 → fail-closed，且不偽造 version。
    k := private_bsr.gate_classify(false, NULL);
    RETURN jsonb_build_object('exists', false,
                              'blocked', true,
                              'reason', k ->> 'reason',
                              'detail', k ->> 'detail',
                              'blocked_at', NULL, 'nonce', NULL,
                              'terminal_code', NULL, 'version', NULL);
  END IF;
  c := s -> 'config';
  k := private_bsr.gate_classify(true, c);
  RETURN jsonb_build_object(
    'exists', true,
    'blocked', (k ->> 'blocked')::boolean,
    'reason', COALESCE(k ->> 'reason', c ->> 'admission_reason'),
    'detail', k ->> 'detail',
    'blocked_at', c ->> 'admission_blocked_at',
    'nonce', c ->> 'admission_nonce',
    'terminal_code', c ->> 'admission_terminal_code',
    'version', s -> 'version');
END $$;

-- ---------------------------------------------------------------- wrapper 2: block + terminalize
-- SECURITY DEFINER 理由：需要在同一交易內鎖 gate 列、寫 tw_bsr_sync_config、
-- 條件式更新 queue、寫 audit_logs / degrade_events；以固定身分執行才能保證原子性
-- 與稽核可信度。所有輸入都在函式內硬性驗證：terminal_code 白名單、三個陣列長度
-- 必須 pairwise 相符、批次上限 500、evidence 必須是 object 且通過 denylist。
-- queue 只在 pairwise lease 完全吻合（status='running' 且 started_at / attempts 相同）
-- 時才標記，確保不會誤殺別的 run 的工作。
CREATE OR REPLACE FUNCTION public.bsr_block_and_terminalize_claims(
  p_run_id uuid,
  p_claim_ids bigint[],
  p_claim_started_at timestamptz[],
  p_claim_attempts int[],
  p_terminal_code text,
  p_sanitized_evidence jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
DECLARE
  v_cfg jsonb; v_ver int; v_blocked boolean;
  v_transition text; v_updated int := 0; v_n int;
  v_now timestamptz := now();
BEGIN
  IF p_terminal_code IS DISTINCT FROM 'finmind_admission_provider_plan_rejected' THEN
    RAISE EXCEPTION 'terminal_code_not_allowed: %', p_terminal_code;
  END IF;
  IF p_claim_ids IS NULL OR p_claim_started_at IS NULL OR p_claim_attempts IS NULL THEN
    RAISE EXCEPTION 'claim_arrays_null';
  END IF;
  v_n := array_length(p_claim_ids, 1);
  IF COALESCE(v_n,0) <> COALESCE(array_length(p_claim_started_at,1),0)
     OR COALESCE(v_n,0) <> COALESCE(array_length(p_claim_attempts,1),0) THEN
    RAISE EXCEPTION 'claim_arrays_length_mismatch';
  END IF;
  IF COALESCE(v_n,0) > 500 THEN RAISE EXCEPTION 'claim_batch_too_large: %', v_n; END IF;
  IF p_sanitized_evidence IS NULL OR jsonb_typeof(p_sanitized_evidence) <> 'object' THEN
    RAISE EXCEPTION 'evidence_must_be_object';
  END IF;
  PERFORM private_bsr.assert_sanitized(p_sanitized_evidence, 0);

  -- 1. linearization point：取得 gate 列鎖之後才讀狀態。
  SELECT c.config, c.version INTO v_cfg, v_ver
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gate_row_missing: market_batch'; END IF;
  IF jsonb_typeof(v_cfg) <> 'object' THEN RAISE EXCEPTION 'gate_config_not_object'; END IF;

  v_blocked := (private_bsr.gate_classify(true, v_cfg) ->> 'blocked')::boolean;

  -- 2. 冪等關閘
  IF v_blocked THEN
    v_transition := 'already_blocked';
  ELSE
    v_transition := 'blocked';
    UPDATE public.tw_bsr_sync_config c
       SET config = c.config
             || jsonb_build_object(
                  'admission_blocked', true,
                  'admission_reason', 'provider_plan_rejected',
                  'admission_terminal_code', p_terminal_code,
                  'admission_blocked_at', to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SSZ'),
                  'admission_evidence', p_sanitized_evidence,
                  'admission_run_id', p_run_id::text,
                  'admission_nonce', gen_random_uuid()::text),
           version = c.version + 1,
           updated_at = v_now
     WHERE c.key = 'market_batch';
    v_ver := v_ver + 1;
  END IF;

  -- 3. pairwise terminalize：只動本 run 真正持有 lease 的列。
  IF COALESCE(v_n,0) > 0 THEN
    WITH claim(id, started_at, attempts) AS (
      SELECT * FROM unnest(p_claim_ids, p_claim_started_at, p_claim_attempts)
    )
    UPDATE public.tw_bsr_sync_queue q
       SET status = 'failed',
           last_error = p_terminal_code,
           finished_at = v_now,
           next_run_at = q.next_run_at,
           updated_at = v_now
      FROM claim
     WHERE q.id = claim.id
       AND q.status = 'running'
       AND q.started_at IS NOT DISTINCT FROM claim.started_at
       AND q.attempts IS NOT DISTINCT FROM claim.attempts;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  -- 4. gate transition 稽核（冪等呼叫不寫入）
  IF v_transition = 'blocked' THEN
    INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
    VALUES (NULL, 'bsr_admission_blocked', 'tw_bsr_sync_config', NULL,
            jsonb_build_object('key','market_batch','gate_version',v_ver,
                               'run_id',p_run_id,'terminal_code',p_terminal_code,
                               'evidence',p_sanitized_evidence,'terminalized',v_updated));
    INSERT INTO public.tw_bsr_degrade_events(api_name, from_mode, to_mode, reason, detail)
    VALUES ('finmind','admission_open','admission_blocked','provider_plan_rejected',
            jsonb_build_object('gate_version',v_ver,'run_id',p_run_id,'terminalized',v_updated));
  END IF;

  RETURN jsonb_build_object(
    'gate_version', v_ver,
    'transition', v_transition,
    'claim_count', COALESCE(v_n,0),
    'updated_count', v_updated,
    'lost_lease_count', COALESCE(v_n,0) - v_updated);
END $$;

-- ---------------------------------------------------------------- wrapper 3: unblock after probe
-- SECURITY DEFINER 理由：與 wrapper 2 對稱，需鎖同一列並寫稽核。
-- 開閘條件極嚴：evidence 必須是 schema v1、HTTP 200、sample_row_count > 0，
-- 且 expected_version + nonce 必須與現況完全相符（stale / 重放自然失敗），
-- 因此無法被單純「呼叫得到」的人任意開閘。
CREATE OR REPLACE FUNCTION public.bsr_unblock_after_probe(
  p_expected_version int,
  p_nonce text,
  p_sanitized_evidence jsonb,
  p_verified_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
DECLARE v_cfg jsonb; v_ver int; v_now timestamptz := now();
BEGIN
  IF p_sanitized_evidence IS NULL OR jsonb_typeof(p_sanitized_evidence) <> 'object' THEN
    RAISE EXCEPTION 'evidence_must_be_object';
  END IF;
  IF (p_sanitized_evidence ->> 'admission_probe_schema_version') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'probe_schema_version_unsupported';
  END IF;
  IF (p_sanitized_evidence ->> 'probe_at') IS NULL
     OR (p_sanitized_evidence ->> 'http_status') IS NULL
     OR (p_sanitized_evidence ->> 'sample_stock_id') IS NULL
     OR (p_sanitized_evidence ->> 'sample_row_count') IS NULL THEN
    RAISE EXCEPTION 'probe_evidence_incomplete';
  END IF;
  IF (p_sanitized_evidence ->> 'http_status') <> '200'
     OR (p_sanitized_evidence ->> 'sample_row_count')::int <= 0 THEN
    RAISE EXCEPTION 'probe_not_successful';
  END IF;
  PERFORM private_bsr.assert_sanitized(p_sanitized_evidence, 0);

  SELECT c.config, c.version INTO v_cfg, v_ver
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gate_row_missing: market_batch'; END IF;

  IF (private_bsr.gate_classify(true, v_cfg) ->> 'blocked')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('transition','already_open','gate_version',v_ver);
  END IF;
  IF v_ver IS DISTINCT FROM p_expected_version
     OR (v_cfg ->> 'admission_nonce') IS DISTINCT FROM p_nonce THEN
    RETURN jsonb_build_object('transition','stale_probe','gate_version',v_ver);
  END IF;

  UPDATE public.tw_bsr_sync_config c
     SET config = (c.config - 'admission_evidence')
           || jsonb_build_object(
                'admission_blocked', false,
                'admission_reason', NULL,
                'last_blocked_at', c.config -> 'admission_blocked_at',
                'admission_blocked_at', NULL,
                'admission_probe', p_sanitized_evidence,
                'admission_probe_at', to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SSZ')),
         version = c.version + 1,
         updated_at = v_now,
         updated_by = p_verified_actor
   WHERE c.key = 'market_batch';
  v_ver := v_ver + 1;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (p_verified_actor, 'bsr_admission_unblocked', 'tw_bsr_sync_config', NULL,
          jsonb_build_object('key','market_batch','gate_version',v_ver,'probe',p_sanitized_evidence));
  INSERT INTO public.tw_bsr_degrade_events(api_name, from_mode, to_mode, reason, detail)
  VALUES ('finmind','admission_blocked','admission_open','probe_verified',
          jsonb_build_object('gate_version',v_ver,'actor',p_verified_actor));

  RETURN jsonb_build_object('transition','unblocked','gate_version',v_ver);
END $$;

-- ---------------------------------------------------------------- ACL：service_role only
REVOKE ALL ON FUNCTION public.bsr_admission_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bsr_block_and_terminalize_claims(uuid, bigint[], timestamptz[], int[], text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bsr_unblock_after_probe(int, text, jsonb, uuid) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.bsr_admission_status() FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.bsr_block_and_terminalize_claims(uuid, bigint[], timestamptz[], int[], text, jsonb) FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.bsr_unblock_after_probe(int, text, jsonb, uuid) FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN RAISE NOTICE 'anon/authenticated absent'; END $$;
GRANT EXECUTE ON FUNCTION public.bsr_admission_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_block_and_terminalize_claims(uuid, bigint[], timestamptz[], int[], text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_unblock_after_probe(int, text, jsonb, uuid) TO service_role;

REVOKE ALL ON FUNCTION private_bsr.gate_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION private_bsr.gate_classify(boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_bsr.assert_sanitized(jsonb, int) FROM PUBLIC;
