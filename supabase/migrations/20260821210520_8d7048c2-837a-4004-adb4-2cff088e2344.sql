-- Guard delta: allow verifiable service_role / owner (postgres) bootstrap execution of
-- build_expert_public_sample, WITHOUT relying on current_user (which equals the function
-- owner inside SECURITY DEFINER and would let any caller that wrongly obtained EXECUTE pass).

CREATE OR REPLACE FUNCTION public.sample_caller_is_service_bootstrap()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  su text := pg_catalog.session_user::text;
  claims jsonb;
  jrole text;
BEGIN
  -- Direct superuser / owner database sessions (migrations, psql as postgres).
  -- session_user is the authenticated login role and is NOT rewritten by SECURITY DEFINER.
  IF su IN ('postgres', 'supabase_admin') THEN
    RETURN true;
  END IF;

  -- PostgREST sessions: login role is always 'authenticator'; the effective role comes from
  -- the signature-verified JWT claim. anon / authenticated JWTs never satisfy this.
  IF su <> 'authenticator' THEN
    RETURN false;
  END IF;

  BEGIN
    claims := pg_catalog.current_setting('request.jwt.claims', true)::jsonb;
  EXCEPTION WHEN others THEN
    claims := NULL;
  END;

  jrole := claims->>'role';
  RETURN jrole = 'service_role';
END;
$function$;

REVOKE ALL ON FUNCTION public.sample_caller_is_service_bootstrap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sample_caller_is_service_bootstrap() FROM anon;
REVOKE ALL ON FUNCTION public.sample_caller_is_service_bootstrap() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sample_caller_is_service_bootstrap() TO service_role;

CREATE OR REPLACE FUNCTION public.build_expert_public_sample(_expert_id uuid, _week_start date, _selections jsonb)
 RETURNS TABLE(signal_id uuid, source_field text, label text, ok boolean, fail_reason text, masked_text text, truncated boolean, raw_text text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  el jsonb;
  n int;
  sid uuid;
  fld text;
  raw text;
  red jsonb;
  wk date;
  st public.signal_status;
  eid uuid;
  seen text[] := ARRAY[]::text[];
  pair text;
  masked text;
  trunc boolean;
BEGIN
  IF NOT (
       public.sample_caller_is_service_bootstrap()
       OR (auth.uid() IS NOT NULL
           AND public.has_role(auth.uid(), 'company_admin'::public.app_role))
     ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM 1 FROM public.experts e
   WHERE e.id = _expert_id AND e.role = 'mentor'::public.expert_role AND e.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expert_not_active_mentor';
  END IF;

  IF _week_start IS NULL
     OR _week_start <> (pg_catalog.date_trunc('week', _week_start::timestamp))::date
     OR (_week_start + 7) > ((now() AT TIME ZONE 'Asia/Taipei')::date) THEN
    RAISE EXCEPTION 'week_not_closed';
  END IF;

  IF _selections IS NULL OR pg_catalog.jsonb_typeof(_selections) <> 'array' THEN
    RAISE EXCEPTION 'bad_selections';
  END IF;
  n := pg_catalog.jsonb_array_length(_selections);
  IF n < 2 OR n > 4 THEN
    RAISE EXCEPTION 'bad_selection_count';
  END IF;

  FOR el IN SELECT * FROM pg_catalog.jsonb_array_elements(_selections) LOOP
    IF pg_catalog.jsonb_typeof(el) <> 'object' THEN
      RAISE EXCEPTION 'bad_selection_item';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 2
       OR NOT (el ? 'signal_id') OR NOT (el ? 'source_field') THEN
      RAISE EXCEPTION 'bad_selection_keys';
    END IF;

    fld := el->>'source_field';
    IF fld NOT IN ('reason_summary','reason_detail','risk_notes','learning_points','overall_summary') THEN
      RAISE EXCEPTION 'bad_source_field';
    END IF;

    BEGIN
      sid := (el->>'signal_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'bad_signal_id';
    END;

    pair := sid::text || ':' || fld;
    IF pair = ANY(seen) THEN
      RAISE EXCEPTION 'duplicate_selection';
    END IF;
    seen := seen || pair;

    SELECT s.expert_id, s.status,
           (pg_catalog.date_trunc('week', (s.published_at AT TIME ZONE 'Asia/Taipei')))::date,
           CASE fld
             WHEN 'reason_summary'  THEN s.reason_summary
             WHEN 'reason_detail'   THEN s.reason_detail
             WHEN 'risk_notes'      THEN s.risk_notes
             WHEN 'learning_points' THEN s.learning_points
             WHEN 'overall_summary' THEN s.overall_summary
           END
      INTO eid, st, wk, raw
      FROM public.expert_signals s
     WHERE s.id = sid;

    IF eid IS NULL THEN
      RAISE EXCEPTION 'signal_not_found';
    END IF;
    IF eid <> _expert_id THEN
      RAISE EXCEPTION 'cross_teacher_selection';
    END IF;
    IF st <> 'published'::public.signal_status THEN
      RAISE EXCEPTION 'signal_not_published';
    END IF;
    IF wk <> _week_start THEN
      RAISE EXCEPTION 'signal_week_mismatch';
    END IF;

    red := public.sample_redact_m1(public.sample_normalize_text(raw));
    masked := coalesce(red->>'text', '');
    trunc := false;
    IF (red->>'ok')::boolean AND pg_catalog.length(masked) > 1200 THEN
      masked := pg_catalog.left(masked, 1200);
      trunc := true;
    END IF;

    signal_id := sid;
    source_field := fld;
    label := CASE fld
               WHEN 'overall_summary' THEN '當週操作復盤'
               WHEN 'reason_summary'  THEN '判斷依據'
               WHEN 'reason_detail'   THEN '判斷依據（細節）'
               WHEN 'risk_notes'      THEN '風險情境'
               WHEN 'learning_points' THEN '學習重點'
             END;
    ok := (red->>'ok')::boolean;
    fail_reason := red->>'reason';
    masked_text := CASE WHEN ok THEN masked ELSE '' END;
    truncated := trunc;
    raw_text := coalesce(raw, '');
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) TO service_role;