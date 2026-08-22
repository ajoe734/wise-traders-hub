-- S3B C1 — read-only gate invariant validator (G1 mitigation).
-- Purpose: decide, WITHOUT mutating anything, whether public.tw_bsr_sync_config
-- (key='market_batch') is in exactly one of two accepted states:
--   * exact_v7_preimage      -> RESULT=C1_NEEDED             (exit 0)
--   * exact_canonical_v8     -> RESULT=C1_ALREADY_CANONICAL  (exit 0)
-- Anything else raises a specific error code (exit nonzero under ON_ERROR_STOP=1).
--
-- Hard rules: no CREATE / UPDATE / INSERT / DELETE / DDL. Pure SELECT + DO(read).
-- Intended call sites: disposable clone tests, CI, and pre-restore/pre-replay
-- verification before applying the C1 migration. Safe to run against production
-- read-only.
--
-- Usage: psql "$URL" -X -v ON_ERROR_STOP=1 -f db/r1/c/C1/validate_gate_invariant.sql

\set ON_ERROR_STOP on
\pset pager off
\timing off

DO $v$
DECLARE
  v_cfg   jsonb;
  v_ver   int;
  v_md5   text;
  v_keys  text[];
  v_ev    jsonb;
  v_state text;
  v_priv  boolean;
  v_dummy text;
  LEGACY9 constant text[] := ARRAY[
    'enabled','probed_at','supported','last_probe_at','last_probe_error',
    'last_probe_format','threshold_pending','last_probe_outcome',
    'min_stocks_in_response'];
  ADMISSION7 constant text[] := ARRAY[
    'admission_blocked','admission_reason','admission_terminal_code',
    'admission_blocked_at','admission_run_id','admission_nonce',
    'admission_evidence'];
  EV6 constant text[] := ARRAY[
    'schema_version','provider','observed_at','http_status','outcome','decided_by'];
  V7_MD5 constant text := 'dd747a45d3e46b2acc3f0c021bc269f8';
BEGIN
  ------------------------------------------------------------------
  -- 0. row presence / shape
  ------------------------------------------------------------------
  SELECT c.config, c.version, md5(c.config::text)
    INTO v_cfg, v_ver, v_md5
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'c1v_gate_row_missing: no tw_bsr_sync_config row with key=market_batch';
  END IF;
  IF v_cfg IS NULL THEN
    RAISE EXCEPTION 'c1v_gate_config_null';
  END IF;
  IF jsonb_typeof(v_cfg) <> 'object' THEN
    RAISE EXCEPTION 'c1v_gate_config_not_object: jsonb_typeof=%', jsonb_typeof(v_cfg);
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM jsonb_object_keys(v_cfg) k;

  ------------------------------------------------------------------
  -- 1. tri-state dispatch on version
  ------------------------------------------------------------------
  IF v_ver = 7 THEN
    v_state := 'exact_v7_preimage';
  ELSIF v_ver = 8 THEN
    v_state := 'exact_canonical_v8';
  ELSE
    RAISE EXCEPTION 'c1v_unexpected_version: version=% md5=%', v_ver, v_md5;
  END IF;

  ------------------------------------------------------------------
  -- 2a. exact_v7_preimage
  ------------------------------------------------------------------
  IF v_state = 'exact_v7_preimage' THEN
    IF v_md5 <> V7_MD5 THEN
      RAISE EXCEPTION 'c1v_v7_hash_drift: expected=% actual=%', V7_MD5, v_md5;
    END IF;
    IF NOT (v_keys @> LEGACY9 AND LEGACY9 @> v_keys) THEN
      RAISE EXCEPTION 'c1v_v7_keyset_drift: expected9=% actual=%',
        array_to_string(LEGACY9,','), array_to_string(v_keys,',');
    END IF;
    RAISE NOTICE 'C1_VALIDATOR state=exact_v7_preimage version=7 md5=% keys=9', v_md5;
    RAISE NOTICE 'RESULT=C1_NEEDED';
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- 2b. exact_canonical_v8
  ------------------------------------------------------------------
  -- keyset must be EXACTLY 9 legacy + 7 admission = 16 (no partial, no extra)
  IF array_length(v_keys,1) <> 16
     OR NOT (v_keys @> (LEGACY9 || ADMISSION7))
     OR NOT ((LEGACY9 || ADMISSION7) @> v_keys) THEN
    RAISE EXCEPTION 'c1v_v8_keyset_mismatch: n=% actual=% expected=%',
      coalesce(array_length(v_keys,1),0),
      array_to_string(v_keys,','),
      array_to_string(LEGACY9 || ADMISSION7, ',');
  END IF;

  -- types
  IF jsonb_typeof(v_cfg->'admission_blocked') <> 'boolean' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_blocked: %', jsonb_typeof(v_cfg->'admission_blocked');
  END IF;
  IF jsonb_typeof(v_cfg->'admission_reason') <> 'string' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_reason: %', jsonb_typeof(v_cfg->'admission_reason');
  END IF;
  IF jsonb_typeof(v_cfg->'admission_terminal_code') <> 'string' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_terminal_code: %', jsonb_typeof(v_cfg->'admission_terminal_code');
  END IF;
  IF jsonb_typeof(v_cfg->'admission_blocked_at') <> 'string' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_blocked_at: %', jsonb_typeof(v_cfg->'admission_blocked_at');
  END IF;
  IF jsonb_typeof(v_cfg->'admission_run_id') <> 'string' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_run_id: %', jsonb_typeof(v_cfg->'admission_run_id');
  END IF;
  IF jsonb_typeof(v_cfg->'admission_nonce') <> 'string' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_nonce: %', jsonb_typeof(v_cfg->'admission_nonce');
  END IF;
  IF jsonb_typeof(v_cfg->'admission_evidence') <> 'object' THEN
    RAISE EXCEPTION 'c1v_v8_type_admission_evidence: %', jsonb_typeof(v_cfg->'admission_evidence');
  END IF;

  -- canonical values
  IF (v_cfg->'admission_blocked') <> 'true'::jsonb THEN
    RAISE EXCEPTION 'c1v_v8_value_admission_blocked: %', v_cfg->'admission_blocked';
  END IF;
  IF v_cfg->>'admission_reason' <> 'provider_plan_rejected' THEN
    RAISE EXCEPTION 'c1v_v8_value_admission_reason: %', v_cfg->>'admission_reason';
  END IF;
  IF v_cfg->>'admission_terminal_code' <> 'bsr_provider_unsupported' THEN
    RAISE EXCEPTION 'c1v_v8_value_admission_terminal_code: %', v_cfg->>'admission_terminal_code';
  END IF;

  -- uuid shape
  IF v_cfg->>'admission_run_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'c1v_v8_run_id_not_uuid: %', v_cfg->>'admission_run_id';
  END IF;
  IF v_cfg->>'admission_nonce' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'c1v_v8_nonce_not_uuid: %', v_cfg->>'admission_nonce';
  END IF;

  -- blocked_at castable to timestamptz
  BEGIN
    PERFORM (v_cfg->>'admission_blocked_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'c1v_v8_blocked_at_not_timestamptz: %', v_cfg->>'admission_blocked_at';
  END;

  -- evidence: exactly 6 keys + exact values
  v_ev := v_cfg->'admission_evidence';
  IF NOT (
       (SELECT count(*) FROM jsonb_object_keys(v_ev)) = 6
       AND (SELECT bool_and(k = ANY(EV6)) FROM jsonb_object_keys(v_ev) k)
       AND (SELECT bool_and(v_ev ? k) FROM unnest(EV6) k)
     ) THEN
    RAISE EXCEPTION 'c1v_v8_evidence_keyset: actual=%',
      (SELECT coalesce(string_agg(k, ',' ORDER BY k),'<none>') FROM jsonb_object_keys(v_ev) k);
  END IF;
  IF v_ev <> jsonb_build_object(
       'schema_version', 1,
       'provider', 'finmind',
       'observed_at', '2026-08-17T13:30:58.060Z',
       'http_status', 400,
       'outcome', 'unsupported_plan',
       'decided_by', 's3b_c1_migration') THEN
    RAISE EXCEPTION 'c1v_v8_evidence_value_drift: %', v_ev::text;
  END IF;

  -- sanitized last_probe_error (exact)
  IF v_cfg->>'last_probe_error' <> 'provider_plan_rejected:http_400' THEN
    RAISE EXCEPTION 'c1v_v8_last_probe_error_not_sanitized: %', v_cfg->>'last_probe_error';
  END IF;

  -- defence in depth: no raw url / token / provider host anywhere in the row
  IF v_cfg::text ~* '(token_tail|finmindtrade|api_token|https?://)' THEN
    RAISE EXCEPTION 'c1v_v8_raw_leak_detected';
  END IF;

  -- private_bsr.assert_sanitized when the calling role may execute it
  SELECT has_function_privilege(current_user, 'private_bsr.assert_sanitized(jsonb,integer)', 'EXECUTE')
    INTO v_priv;
  IF coalesce(v_priv,false) THEN
    PERFORM private_bsr.assert_sanitized(v_cfg, 0);
    RAISE NOTICE 'C1_VALIDATOR assert_sanitized=PASS';
  ELSE
    RAISE NOTICE 'C1_VALIDATOR assert_sanitized=SKIPPED_NO_EXECUTE_PRIV (role=%); inline sanitize checks applied', current_user;
  END IF;

  RAISE NOTICE 'C1_VALIDATOR state=exact_canonical_v8 version=8 keys=16 md5=%', v_md5;
  RAISE NOTICE 'RESULT=C1_ALREADY_CANONICAL';
END
$v$;

-- machine-readable single-line verdict (SELECT only)
SELECT 'C1_VALIDATOR_VERDICT|'
       || (SELECT version::text FROM public.tw_bsr_sync_config WHERE key='market_batch')
       || '|' || (SELECT md5(config::text) FROM public.tw_bsr_sync_config WHERE key='market_batch')
       || '|' || CASE (SELECT version FROM public.tw_bsr_sync_config WHERE key='market_batch')
                   WHEN 7 THEN 'C1_NEEDED'
                   WHEN 8 THEN 'C1_ALREADY_CANONICAL'
                 END AS verdict;
