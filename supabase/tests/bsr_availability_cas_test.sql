-- Stage 3B / S3B-0 RED test — 單一 server-side availability truth（canonical v8）
--
-- S3B-C1 會用 compare-and-set migration 把 public.tw_bsr_sync_config('market_batch')
-- 從 version=7 推到 version=8，並寫入 7 個 admission_* 鍵，宣告
-- provider_plan_rejected。本檔釘死「canonical v8 的精確形狀」：
--   version = 8（不是 >=8，不是 7）
--   恰好這 7 鍵：admission_blocked / admission_reason / admission_terminal_code /
--                admission_blocked_at / admission_run_id / admission_nonce /
--                admission_evidence
--   型別與值：blocked=boolean true、reason='provider_plan_rejected'、
--             terminal_code='bsr_provider_unsupported'、blocked_at 可轉 timestamptz、
--             run_id/nonce 可轉 uuid、evidence 為 object
-- 缺鍵、多鍵、型別或值不符、version≠8 一律視為 partial_or_mismatched 失敗。
--
-- 另外驗證 private_bsr.gate_classify 對 canonical v8 的判讀，以及
-- assert_sanitized 不讓 provider token 洩進 evidence。
--
-- 本檔在 S3B-C1 之前必須 RED。
-- 隔離協定（v4.1）：BEGIN + SAVEPOINT + 最終 ROLLBACK；classify/sanitize 分支只在
-- fixture savepoint 內操作 config；前後比對 config hash / queue count 0 delta。
--
-- 執行：psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_availability_canonical_v8_test.sql

\set ON_ERROR_STOP on
BEGIN;

\i supabase/tests/_s3b0_snapshot.sql
CALL s3b0_snapshot('before');

-- ─────────────────────────────────────────────
-- Fixture：重建 production 當前的 v7 gate row（尚未宣告 admission_*）
--   clone 的資料表為空，若不建 fixture，RED 會以「row 不存在」失敗，
--   而非我們要釘的「version 必須為 8，實得 7」。fixture 全程 savepoint 隔離。
-- ─────────────────────────────────────────────
SAVEPOINT fx_prod_v7;

DELETE FROM public.tw_bsr_sync_config WHERE key = 'market_batch';
INSERT INTO public.tw_bsr_sync_config (key, version, config, updated_at)
VALUES ('market_batch', 7, jsonb_build_object('enabled', true), now());

-- ─────────────────────────────────────────────
-- Case 1：canonical v8 —— version=8 且 admission_* 恰好 7 鍵、型別與值精確相符
-- ─────────────────────────────────────────────
DO $$
DECLARE
  v_ver int; v_cfg jsonb; v_keys text[];
  expected text[] := ARRAY[
    'admission_blocked','admission_reason','admission_terminal_code',
    'admission_blocked_at','admission_run_id','admission_nonce','admission_evidence'];
BEGIN
  SELECT version, config INTO v_ver, v_cfg
    FROM public.tw_bsr_sync_config WHERE key = 'market_batch';
  ASSERT FOUND, 'case1: partial_or_mismatched — market_batch gate row 不存在';
  ASSERT v_ver = 8,
    format('case1: partial_or_mismatched — version 必須為 8，實得 %s', v_ver);

  SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM jsonb_object_keys(v_cfg) k WHERE k LIKE 'admission_%';
  ASSERT v_keys = (SELECT array_agg(e ORDER BY e) FROM unnest(expected) e),
    format('case1: partial_or_mismatched — admission_* 鍵集合不符，實得 %s', v_keys);

  ASSERT jsonb_typeof(v_cfg->'admission_blocked') = 'boolean'
         AND (v_cfg->'admission_blocked') = 'true'::jsonb,
    format('case1: partial_or_mismatched — admission_blocked 必須為 boolean true，實得 %s',
           v_cfg->'admission_blocked');
  ASSERT v_cfg->>'admission_reason' = 'provider_plan_rejected',
    format('case1: partial_or_mismatched — admission_reason=%s', v_cfg->>'admission_reason');
  ASSERT v_cfg->>'admission_terminal_code' = 'bsr_provider_unsupported',
    format('case1: partial_or_mismatched — admission_terminal_code=%s',
           v_cfg->>'admission_terminal_code');
  ASSERT (v_cfg->>'admission_blocked_at')::timestamptz IS NOT NULL,
    'case1: partial_or_mismatched — admission_blocked_at 非合法 timestamptz';
  ASSERT (v_cfg->>'admission_run_id')::uuid IS NOT NULL,
    'case1: partial_or_mismatched — admission_run_id 非合法 uuid';
  ASSERT (v_cfg->>'admission_nonce')::uuid IS NOT NULL,
    'case1: partial_or_mismatched — admission_nonce 非合法 uuid';
  ASSERT jsonb_typeof(v_cfg->'admission_evidence') = 'object',
    format('case1: partial_or_mismatched — admission_evidence 必須為 object，實得 %s',
           jsonb_typeof(v_cfg->'admission_evidence'));
END $$;

-- ─────────────────────────────────────────────
-- Case 2：evidence 不得含 provider token/credential 痕跡（沿用 assert_sanitized）
-- ─────────────────────────────────────────────
DO $$
DECLARE v_cfg jsonb; s text;
BEGIN
  SELECT config INTO v_cfg FROM public.tw_bsr_sync_config WHERE key = 'market_batch';
  PERFORM private_bsr.assert_sanitized(v_cfg->'admission_evidence', 0);

  s := lower(COALESCE(v_cfg->>'admission_evidence', ''));
  ASSERT s NOT LIKE '%token%' AND s NOT LIKE '%api_key%' AND s NOT LIKE '%authorization%',
    'case2: admission_evidence 疑似含憑證字樣';
END $$;

-- ─────────────────────────────────────────────
-- Case 3：gate_classify 對 canonical v8 必須回 blocked=true / provider_plan_rejected
-- ─────────────────────────────────────────────
DO $$
DECLARE v_cfg jsonb; v_out jsonb; v_state jsonb;
BEGIN
  SELECT config INTO v_cfg FROM public.tw_bsr_sync_config WHERE key = 'market_batch';
  v_out := private_bsr.gate_classify(true, v_cfg);
  ASSERT (v_out->>'blocked')::boolean IS TRUE,
    format('case3: gate_classify 必須 blocked=true，實得 %s', v_out);
  ASSERT v_out->>'reason' = 'provider_plan_rejected',
    format('case3: gate_classify reason 必須 provider_plan_rejected，實得 %s', v_out);

  v_state := private_bsr.gate_state();
  ASSERT (v_state->>'version')::int = 8,
    format('case3: gate_state().version 必須為 8，實得 %s', v_state);
END $$;

-- ─────────────────────────────────────────────
-- Case 4（fixture）：CAS 冪等 —— 已是 v8 canonical 時再次宣告必須 no-op（不得變 v9）
-- ─────────────────────────────────────────────
SAVEPOINT fx_cas;

DO $$
DECLARE v_before jsonb; v_after jsonb; v_ver_before int; v_ver_after int;
BEGIN
  SELECT version, config INTO v_ver_before, v_before
    FROM public.tw_bsr_sync_config WHERE key = 'market_batch';

  -- 以 gate RPC 走一次自然路徑；canonical v8 下必須是 already_blocked / no-op
  PERFORM public.bsr_admission_status();

  SELECT version, config INTO v_ver_after, v_after
    FROM public.tw_bsr_sync_config WHERE key = 'market_batch';

  ASSERT v_ver_after = v_ver_before,
    format('case4: canonical v8 下 version 不得遞增 (%s -> %s)', v_ver_before, v_ver_after);
  ASSERT v_after = v_before, 'case4: canonical v8 下 config 不得被改寫';
END $$;

ROLLBACK TO SAVEPOINT fx_cas;
ROLLBACK TO SAVEPOINT fx_prod_v7;

-- ─────────────────────────────────────────────
-- 零殘留驗證
-- ─────────────────────────────────────────────
CALL s3b0_assert_no_residue();

ROLLBACK;
