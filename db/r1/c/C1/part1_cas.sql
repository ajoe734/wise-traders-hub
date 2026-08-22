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

