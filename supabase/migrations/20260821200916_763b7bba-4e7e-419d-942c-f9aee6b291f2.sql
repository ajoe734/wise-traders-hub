-- ── table ────────────────────────────────────────────────────────────────────
CREATE TABLE public.expert_public_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  week_start_taipei date NOT NULL,
  sections jsonb NOT NULL,
  source_selections jsonb NOT NULL,
  source_signal_ids uuid[] NOT NULL,
  source_content_hash text NOT NULL,
  mask_level text NOT NULL DEFAULT 'M1',
  status text NOT NULL CHECK (status IN ('approved','revoked')),
  approved_by uuid,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.expert_public_samples TO service_role;

ALTER TABLE public.expert_public_samples ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX expert_public_samples_one_approved
  ON public.expert_public_samples (expert_id)
  WHERE status = 'approved';

CREATE INDEX expert_public_samples_expert_idx
  ON public.expert_public_samples (expert_id, status);

-- ── deterministic M1 redaction ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sample_redact_m1(_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t text := coalesce(_text, '');
BEGIN
  IF btrim(t) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_source', 'text', '');
  END IF;

  -- fail-closed categories (never masked, never rewritten)
  IF t ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_email', 'text', '');
  END IF;
  IF t ~ '(09[0-9]{8}|\+886[0-9]{6,}|0[2-8]-[0-9]{6,8})' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_phone', 'text', '');
  END IF;
  IF t ~* '(https?://|line\.me|t\.me|@[A-Za-z0-9_]{4,})' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_url_or_line', 'text', '');
  END IF;
  IF t ~ '[^[:ascii:]]{2,3}(老師|先生|小姐|總監|執行長)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pii_person_name', 'text', '');
  END IF;
  IF t ~ '(明天|下週|下周|接下來|後續)[^。！!?？]{0,12}(買進|賣出|進場|出場|加碼|減碼|停損|目標價|布局)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'future_instruction', 'text', '');
  END IF;

  -- deterministic masking
  t := regexp_replace(t, '[0-9]+(\.[0-9]+)?\s*(元|塊|美元|USD|NT\$)', '［價格已隱藏］', 'g');
  t := regexp_replace(t, '(價位|成本|均價|報價)\s*[:：]?\s*[0-9]+(\.[0-9]+)?', '\1［價格已隱藏］', 'g');
  t := regexp_replace(t, '[0-9]+(\.[0-9]+)?\s*(張|口|股|部位|單位|手)', '［數量已隱藏］', 'g');
  t := regexp_replace(t, '[0-9]+(\.[0-9]+)?\s*%', '［比例已隱藏］', 'g');
  t := regexp_replace(t, '(全倉|半倉|滿倉)', '［比例已隱藏］', 'g');

  -- residual unclassified numeric leakage -> fail closed
  IF t ~ '[0-9]{5,}' OR t ~ '[0-9]+\.[0-9]{2,}' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unclassified_numeric', 'text', '');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', null, 'text', t);
END;
$$;

REVOKE ALL ON FUNCTION public.sample_redact_m1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sample_redact_m1(text) TO service_role;

-- ── shared builder: server reads the source text itself ──────────────────────
CREATE OR REPLACE FUNCTION public.build_expert_public_sample(
  _expert_id uuid,
  _week_start date,
  _selections jsonb
)
RETURNS TABLE (
  signal_id uuid,
  source_field text,
  label text,
  ok boolean,
  fail_reason text,
  masked_text text,
  truncated boolean,
  raw_text text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  el jsonb;
  n int;
  sid uuid;
  fld text;
  raw text;
  red jsonb;
  wk date;
  st text;
  eid uuid;
  seen text[] := ARRAY[]::text[];
  keyz text;
BEGIN
  IF NOT public.has_role(pg_catalog.auth_uid_safe(), 'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN;
END;
$$;

DROP FUNCTION public.build_expert_public_sample(uuid, date, jsonb);

CREATE OR REPLACE FUNCTION public.build_expert_public_sample(
  _expert_id uuid,
  _week_start date,
  _selections jsonb
)
RETURNS TABLE (
  signal_id uuid,
  source_field text,
  label text,
  ok boolean,
  fail_reason text,
  masked_text text,
  truncated boolean,
  raw_text text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
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
  -- 1. authz
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- 1b. expert must be an active mentor
  PERFORM 1 FROM public.experts e
   WHERE e.id = _expert_id AND e.role = 'mentor'::public.expert_role AND e.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expert_not_active_mentor';
  END IF;

  -- 1c. week must be fully closed in Taipei
  IF _week_start IS NULL
     OR _week_start <> (pg_catalog.date_trunc('week', _week_start::timestamp))::date
     OR (_week_start + 7) > ((now() AT TIME ZONE 'Asia/Taipei')::date) THEN
    RAISE EXCEPTION 'week_not_closed';
  END IF;

  -- 2. selections shape
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

    -- 3. server-side source fetch + provenance checks
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

    -- 4/5. redaction (fail-closed) + truncation
    red := public.sample_redact_m1(raw);
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
$$;

REVOKE ALL ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) TO service_role;

-- ── admin preview (dry-run, no write, no raw text leak) ──────────────────────
CREATE OR REPLACE FUNCTION public.preview_expert_public_sample(
  _expert_id uuid,
  _week_start date,
  _selections jsonb
)
RETURNS TABLE (
  signal_id uuid,
  source_field text,
  label text,
  ok boolean,
  fail_reason text,
  masked_text text,
  truncated boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT b.signal_id, b.source_field, b.label, b.ok, b.fail_reason, b.masked_text, b.truncated
    FROM public.build_expert_public_sample(_expert_id, _week_start, _selections) b;
$$;

REVOKE ALL ON FUNCTION public.preview_expert_public_sample(uuid, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_expert_public_sample(uuid, date, jsonb) TO authenticated;

-- ── admin approve (transactional) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_expert_public_sample(
  _expert_id uuid,
  _week_start date,
  _selections jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  secs jsonb;
  ids uuid[];
  sels jsonb;
  raw_concat text;
  bad int;
  new_id uuid;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _tmp_sample_build ON COMMIT DROP AS
    SELECT * FROM public.build_expert_public_sample(_expert_id, _week_start, _selections) WITH NO DATA;
  DELETE FROM _tmp_sample_build;
  INSERT INTO _tmp_sample_build
    SELECT * FROM public.build_expert_public_sample(_expert_id, _week_start, _selections);

  SELECT count(*) INTO bad FROM _tmp_sample_build WHERE NOT ok;
  IF bad > 0 THEN
    RAISE EXCEPTION 'redaction_gate_failed';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('key', b.source_field, 'label', b.label,
                                      'text', b.masked_text, 'truncated', b.truncated)
                   ORDER BY b.signal_id, b.source_field),
         array_agg(DISTINCT b.signal_id),
         jsonb_agg(jsonb_build_object('signal_id', b.signal_id, 'source_field', b.source_field)
                   ORDER BY b.signal_id, b.source_field),
         string_agg(b.raw_text, '|' ORDER BY b.signal_id, b.source_field)
    INTO secs, ids, sels, raw_concat
    FROM _tmp_sample_build b;

  IF secs IS NULL OR jsonb_array_length(secs) < 2 OR jsonb_array_length(secs) > 4 THEN
    RAISE EXCEPTION 'bad_section_count';
  END IF;
  IF pg_catalog.octet_length(secs::text) > 8192 THEN
    RAISE EXCEPTION 'payload_too_large';
  END IF;

  UPDATE public.expert_public_samples
     SET status = 'revoked', revoked_at = now(), updated_at = now()
   WHERE expert_id = _expert_id AND status = 'approved';

  INSERT INTO public.expert_public_samples (
    expert_id, week_start_taipei, sections, source_selections, source_signal_ids,
    source_content_hash, mask_level, status, approved_by, approved_at
  ) VALUES (
    _expert_id, _week_start, secs, sels, ids,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_concat, 'UTF8')), 'hex'),
    'M1', 'approved', auth.uid(), now()
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_expert_public_sample(uuid, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_expert_public_sample(uuid, date, jsonb) TO authenticated;

-- ── admin revoke ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_expert_public_sample(_expert_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.expert_public_samples
     SET status = 'revoked', revoked_at = now(), updated_at = now()
   WHERE expert_id = _expert_id AND status = 'approved';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_expert_public_sample(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_expert_public_sample(uuid) TO authenticated;

-- ── admin status + drift badge ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_expert_public_sample_status(_expert_id uuid)
RETURNS TABLE (
  week_start_taipei date,
  status text,
  mask_level text,
  source_content_hash text,
  source_drifted boolean,
  approved_by uuid,
  approved_at timestamptz,
  section_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r public.expert_public_samples%ROWTYPE;
  el jsonb;
  cur text := '';
  parts text[] := ARRAY[]::text[];
  raw text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'company_admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO r FROM public.expert_public_samples
   WHERE expert_id = _expert_id AND status = 'approved' LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR el IN SELECT * FROM pg_catalog.jsonb_array_elements(r.source_selections) LOOP
    SELECT CASE el->>'source_field'
             WHEN 'reason_summary'  THEN s.reason_summary
             WHEN 'reason_detail'   THEN s.reason_detail
             WHEN 'risk_notes'      THEN s.risk_notes
             WHEN 'learning_points' THEN s.learning_points
             WHEN 'overall_summary' THEN s.overall_summary
           END
      INTO raw
      FROM public.expert_signals s
     WHERE s.id = (el->>'signal_id')::uuid;
    parts := parts || coalesce(raw, '');
  END LOOP;

  cur := array_to_string(parts, '|');

  week_start_taipei := r.week_start_taipei;
  status := r.status;
  mask_level := r.mask_level;
  source_content_hash := r.source_content_hash;
  source_drifted := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(cur, 'UTF8')), 'hex')
                    IS DISTINCT FROM r.source_content_hash;
  approved_by := r.approved_by;
  approved_at := r.approved_at;
  section_count := pg_catalog.jsonb_array_length(r.sections);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expert_public_sample_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_expert_public_sample_status(uuid) TO authenticated;

-- ── public read (minimal projection) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_expert_public_sample(_slug text)
RETURNS TABLE (
  expert_name text,
  expert_slug text,
  week_start_taipei date,
  sections jsonb,
  mask_level text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT e.name, e.slug, s.week_start_taipei, s.sections, s.mask_level, s.updated_at
    FROM public.expert_public_samples s
    JOIN public.experts e ON e.id = s.expert_id
   WHERE e.slug = _slug
     AND e.status = 'active'
     AND e.role = 'mentor'::public.expert_role
     AND s.status = 'approved'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_expert_public_sample(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expert_public_sample(text) TO anon, authenticated;