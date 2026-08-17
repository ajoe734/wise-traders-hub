-- =====================================================================
-- Plan v8.1 Stage B — v6 : BSR admission gate (clone-only rehearsal)
-- Scope (approved v6 §3):
--   * CREATE SCHEMA private_bsr + internal gate implementation
--   * 3 public service-role-only wrappers (the only Edge-reachable path)
--   * BEFORE INSERT FOR EACH ROW admission gate trigger on tw_bsr_sync_queue
-- No ALTER TABLE. No new table. No change to any existing function ACL.
-- =====================================================================
\set ON_ERROR_STOP on

SET lock_timeout = '3s';
SET statement_timeout = '120s';

-- ---------------------------------------------------------------- schema
CREATE SCHEMA IF NOT EXISTS private_bsr;
REVOKE ALL ON SCHEMA private_bsr FROM PUBLIC;
-- deliberately NOT granted to anon / authenticated / service_role:
-- private_bsr is never reachable through PostgREST.

-- ---------------------------------------------------------------- helpers
-- gate_state(): raw read, no lock. Used by read-only status wrapper.
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

-- blocked iff admission_blocked is EXPLICIT JSON true.
-- Compatibility decision (v4 §3): a missing/malformed key must NOT close the
-- gate, otherwise the first deploy silently drops every legitimate enqueue
-- while the 77 legacy rows keep looping. The gate only ever closes on exact
-- terminal provider evidence produced by the worker.
CREATE OR REPLACE FUNCTION private_bsr.gate_blocked()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
  SELECT COALESCE(
           (SELECT c.config -> 'admission_blocked' = 'true'::jsonb
              FROM public.tw_bsr_sync_config c
             WHERE c.key = 'market_batch'), false)
$$;

-- recovery predicate (v5 §1): terminal rows may only be recovered when the
-- gate is EXPLICITLY open (JSON false). missing / true / malformed => never.
CREATE OR REPLACE FUNCTION private_bsr.gate_explicit_open()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
  SELECT COALESCE(
           (SELECT c.config -> 'admission_blocked' = 'false'::jsonb
              FROM public.tw_bsr_sync_config c
             WHERE c.key = 'market_batch'), false)
$$;

-- evidence sanitizer: recursive key denylist; raw upstream bodies never land.
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

-- ---------------------------------------------------------------- gate trigger
-- Admission only. Zero business validation: any row the gate lets through keeps
-- byte-identical semantics (including existing CHECK / unique-index errors).
CREATE OR REPLACE FUNCTION public.tw_bsr_sync_queue_admission_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
DECLARE v_cfg jsonb;
BEGIN
  -- linearization: the state read after acquiring the gate row lock.
  SELECT c.config INTO v_cfg
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch'
   FOR SHARE;

  IF v_cfg IS NOT NULL AND v_cfg -> 'admission_blocked' = 'true'::jsonb THEN
    RETURN NULL;   -- silently skip; never raise, never rewrite business fields
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tw_bsr_sync_queue_admission_gate ON public.tw_bsr_sync_queue;
CREATE TRIGGER trg_tw_bsr_sync_queue_admission_gate
BEFORE INSERT ON public.tw_bsr_sync_queue
FOR EACH ROW EXECUTE FUNCTION public.tw_bsr_sync_queue_admission_gate();

-- ---------------------------------------------------------------- wrapper 1: status
CREATE OR REPLACE FUNCTION public.bsr_admission_status()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
DECLARE s jsonb; c jsonb;
BEGIN
  s := private_bsr.gate_state();
  IF s IS NULL THEN
    RETURN jsonb_build_object('exists', false, 'blocked', false,
                              'reason', NULL, 'blocked_at', NULL, 'version', NULL);
  END IF;
  c := s -> 'config';
  RETURN jsonb_build_object(
    'exists', true,
    'blocked', COALESCE(c -> 'admission_blocked' = 'true'::jsonb, false),
    'reason', c ->> 'admission_reason',
    'blocked_at', c ->> 'admission_blocked_at',
    'nonce', c ->> 'admission_nonce',
    'terminal_code', c ->> 'admission_terminal_code',
    'version', s -> 'version');
END $$;

-- ---------------------------------------------------------------- wrapper 2: block + terminalize
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

  -- 1. linearization point: state read after acquiring the gate row lock.
  SELECT c.config, c.version INTO v_cfg, v_ver
    FROM public.tw_bsr_sync_config c
   WHERE c.key = 'market_batch'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gate_row_missing: market_batch'; END IF;
  IF jsonb_typeof(v_cfg) <> 'object' THEN RAISE EXCEPTION 'gate_config_not_object'; END IF;

  v_blocked := COALESCE(v_cfg -> 'admission_blocked' = 'true'::jsonb, false);

  -- 2. idempotent block
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

  -- 3. pairwise terminalize: only rows this run actually holds the lease on.
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

  -- 4. gate transition audit (idempotent call writes nothing)
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

  IF COALESCE(v_cfg -> 'admission_blocked' = 'true'::jsonb, false) IS NOT TRUE THEN
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

-- ---------------------------------------------------------------- ACL
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
REVOKE ALL ON FUNCTION private_bsr.gate_blocked() FROM PUBLIC;
REVOKE ALL ON FUNCTION private_bsr.gate_explicit_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION private_bsr.assert_sanitized(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tw_bsr_sync_queue_admission_gate() FROM PUBLIC;
