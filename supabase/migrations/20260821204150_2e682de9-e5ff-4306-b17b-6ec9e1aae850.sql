ALTER TABLE public.expert_public_samples
  ADD COLUMN approval_source text NOT NULL DEFAULT 'admin_rpc',
  ADD COLUMN approval_note text;

ALTER TABLE public.expert_public_samples
  ADD CONSTRAINT expert_public_samples_approval_source_chk
    CHECK (approval_source IN ('admin_rpc','owner_directive')),
  ADD CONSTRAINT expert_public_samples_approval_note_len_chk
    CHECK (approval_note IS NULL OR pg_catalog.length(approval_note) <= 500),
  ADD CONSTRAINT expert_public_samples_provenance_chk
    CHECK (
      (approval_source = 'admin_rpc' AND approved_by IS NOT NULL)
      OR
      (approval_source = 'owner_directive' AND approved_by IS NULL
       AND approval_note IS NOT NULL AND pg_catalog.btrim(approval_note) <> '')
    );

-- approve RPC: always admin_rpc + auth.uid()
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
    source_content_hash, mask_level, status, approved_by, approved_at,
    approval_source, approval_note
  ) VALUES (
    _expert_id, _week_start, secs, sels, ids,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_concat, 'UTF8')), 'hex'),
    'M1', 'approved', auth.uid(), now(),
    'admin_rpc', NULL
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_expert_public_sample(uuid, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_expert_public_sample(uuid, date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_expert_public_sample(uuid, date, jsonb) TO authenticated;

-- admin status: expose provenance for audit
DROP FUNCTION IF EXISTS public.admin_expert_public_sample_status(uuid);

CREATE OR REPLACE FUNCTION public.admin_expert_public_sample_status(_expert_id uuid)
RETURNS TABLE (
  week_start_taipei date,
  status text,
  mask_level text,
  source_content_hash text,
  source_drifted boolean,
  approved_by uuid,
  approved_at timestamptz,
  section_count integer,
  approval_source text,
  approval_note text
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
  approval_source := r.approval_source;
  approval_note := r.approval_note;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_expert_public_sample_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_expert_public_sample_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_expert_public_sample_status(uuid) TO authenticated;