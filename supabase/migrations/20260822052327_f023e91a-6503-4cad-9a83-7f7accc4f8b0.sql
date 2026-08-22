-- S3B C1: canonical v8 admission gate CAS + wrapper terminal-code canonicalization
-- Scope: exactly one config row (tw_bsr_sync_config.key='market_batch')
--        + exactly one function (public.bsr_block_and_terminalize_claims/6)
-- No queue mutation, no ACL/owner/prosecdef/search_path/RETURNS change, no provider call.

-- ─────────────────────────────────────────────────────────────
-- Part 1: CAS transition v7 -> canonical v8
-- ─────────────────────────────────────────────────────────────
DO $c1$
DECLARE
  v_cfg jsonb; v_ver int; v_md5 text;
  v_now timestamptz := now();
  v_run uuid := gen_random_uuid();
  v_nonce uuid := gen_random_uuid();
  v_new jsonb;
BEGIN
  SELECT c.config, c.version, md5(c.config::text)
    INTO v_cfg, v_ver, v_md5
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'c1_gate_row_missing: market_batch';
  END IF;
  IF jsonb_typeof(v_cfg) <> 'object' THEN
    RAISE EXCEPTION 'c1_gate_config_not_object: %', jsonb_typeof(v_cfg);
  END IF;

  -- idempotent re-run: canonical v8 already installed -> true no-op (0 delta)
  IF (v_cfg -> 'admission_blocked') = 'true'::jsonb
     AND v_cfg ->> 'admission_terminal_code' = 'bsr_provider_unsupported'
     AND v_cfg ->> 'admission_reason' = 'provider_plan_rejected' THEN
    RAISE NOTICE 'c1_noop: canonical v8 already present (version=%)', v_ver;
    RETURN;
  END IF;

  -- exact preimage drift gate
  IF v_ver <> 7 OR v_md5 <> 'dd747a45d3e46b2acc3f0c021bc269f8' THEN
    RAISE EXCEPTION 'c1_preimage_drift: version=% md5=%', v_ver, v_md5;
  END IF;

  v_new := (v_cfg - 'last_probe_error')
        || jsonb_build_object(
             'last_probe_error', 'provider_plan_rejected:http_400',
             'admission_blocked', true,
             'admission_reason', 'provider_plan_rejected',
             'admission_terminal_code', 'bsr_provider_unsupported',
             'admission_blocked_at', to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SSZ'),
             'admission_run_id', v_run::text,
             'admission_nonce', v_nonce::text,
             'admission_evidence', jsonb_build_object(
                 'schema_version', 1,
                 'provider', 'finmind',
                 'observed_at', '2026-08-17T13:30:58.060Z',
                 'http_status', 400,
                 'outcome', 'unsupported_plan',
                 'decided_by', 's3b_c1_migration'));

  PERFORM private_bsr.assert_sanitized(v_new, 0);

  UPDATE public.tw_bsr_sync_config c
     SET config = v_new, version = 8, updated_at = v_now
   WHERE c.key = 'market_batch' AND c.version = 7
     AND md5(c.config::text) = 'dd747a45d3e46b2acc3f0c021bc269f8';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'c1_cas_lost';
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (NULL, 'bsr_admission_blocked', 'tw_bsr_sync_config', NULL,
          jsonb_build_object('key','market_batch','gate_version',8,
                             'run_id', v_run::text,
                             'terminal_code','bsr_provider_unsupported',
                             'reason','provider_plan_rejected',
                             'evidence', v_new -> 'admission_evidence',
                             'decided_by','s3b_c1_migration'));

  INSERT INTO public.tw_bsr_degrade_events(api_name, from_mode, to_mode, reason, detail)
  VALUES ('finmind','legacy_config_missing','admission_blocked','provider_plan_rejected',
          jsonb_build_object('gate_version',8,'run_id',v_run::text,
                             'terminal_code','bsr_provider_unsupported',
                             'evidence', v_new -> 'admission_evidence',
                             'decided_by','s3b_c1_migration'));
END
$c1$;

-- ─────────────────────────────────────────────────────────────
-- Part 2: wrapper terminal-code canonicalization (single function)
-- Unchanged: signature, RETURNS jsonb, SECURITY DEFINER, owner, search_path,
--            ACL, accepted provider/source input code, claim/lease semantics.
-- Changed:   config / audit / degrade / return body now carry the DB canonical
--            terminal code 'bsr_provider_unsupported'.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bsr_block_and_terminalize_claims(p_run_id uuid, p_claim_ids bigint[], p_claim_started_at timestamp with time zone[], p_claim_attempts integer[], p_terminal_code text, p_sanitized_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private_bsr'
AS $function$
DECLARE
  v_cfg jsonb; v_ver int; v_blocked boolean;
  v_transition text; v_updated int := 0; v_n int;
  v_now timestamptz := now();
  v_code constant text := 'bsr_provider_unsupported';
  v_reason constant text := 'provider_plan_rejected';
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
                  'admission_reason', v_reason,
                  'admission_terminal_code', v_code,
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
                               'run_id',p_run_id,'terminal_code',v_code,
                               'source_event',p_terminal_code,
                               'evidence',p_sanitized_evidence,'terminalized',v_updated));
    INSERT INTO public.tw_bsr_degrade_events(api_name, from_mode, to_mode, reason, detail)
    VALUES ('finmind','admission_open','admission_blocked',v_reason,
            jsonb_build_object('gate_version',v_ver,'run_id',p_run_id,
                               'terminal_code',v_code,'terminalized',v_updated));
  END IF;

  RETURN jsonb_build_object(
    'gate_version', v_ver,
    'transition', v_transition,
    'terminal_code', v_code,
    'claim_count', COALESCE(v_n,0),
    'updated_count', v_updated,
    'lost_lease_count', COALESCE(v_n,0) - v_updated);
END $function$;