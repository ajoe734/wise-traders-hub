-- ── deterministic HTML -> plain text normalization ───────────────────────────
CREATE OR REPLACE FUNCTION public.sample_normalize_text(_html text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t text := coalesce(_html, '');
BEGIN
  t := regexp_replace(t, '<\s*br\s*/?\s*>', E'\n', 'gi');
  t := regexp_replace(t, '<\s*/\s*(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section|article)\s*>', E'\n', 'gi');
  t := regexp_replace(t, '<\s*(li|p|div|h[1-6]|tr|blockquote|section|article)(\s[^>]*)?>', E'\n', 'gi');
  t := regexp_replace(t, '<[^>]*>', '', 'g');
  t := replace(t, '&nbsp;', ' ');
  t := replace(t, '&amp;', '&');
  t := replace(t, '&lt;', '<');
  t := replace(t, '&gt;', '>');
  t := replace(t, '&quot;', '"');
  t := replace(t, '&#39;', '''');
  t := replace(t, '&apos;', '''');
  t := regexp_replace(t, '[ \t\r]+', ' ', 'g');
  t := regexp_replace(t, ' *\n *', E'\n', 'g');
  t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
  RETURN pg_catalog.btrim(t);
END;
$$;

REVOKE ALL ON FUNCTION public.sample_normalize_text(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sample_normalize_text(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_normalize_text(text) TO service_role;

-- ── deterministic M1 redaction (v2, plain-text in / plain-text out) ──────────
CREATE OR REPLACE FUNCTION public.sample_redact_m1(_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t  text;
  ry text;
BEGIN
  t := public.sample_normalize_text(coalesce(_text, ''));

  IF pg_catalog.btrim(t) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_source', 'text', '');
  END IF;

  -- residual markup (e.g. literal <script>, escaped tags) -> fail closed
  IF t ~* '<\s*/?\s*[a-z!][^>]*>' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'html_residual', 'text', '');
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

  -- future-instruction gate (expanded)
  IF t ~ '(明天|明日|下週|下周|下個交易日|週一|周一|週五前|周五前|本週內|本周內|接下來|後續)[^。！!?？\n]{0,16}(買進|買好|買|賣出|賣|進場|出場|加碼|減碼|停利|停損|布局|佈局|卡位|準備|上攻|操作)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'future_instruction', 'text', '');
  END IF;
  IF t ~ '(一定要|務必|必須|建議|請|記得)[^。！!?？\n]{0,14}(買進|賣出|進場|出場|加碼|減碼|停利|停損|執行|布局|佈局|卡位|操作|抱住|追價)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'future_instruction', 'text', '');
  END IF;

  -- deterministic masking (ratio -> quantity -> currency -> context -> range/decimal)
  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*%', '［比例已隱藏］', 'g');
  t := regexp_replace(t, '(全倉|半倉|滿倉)', '［比例已隱藏］', 'g');
  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*(張|口|股|部位|單位|手)', '［數量已隱藏］', 'g');
  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*(元|塊|美元|美金|USD|usd|NT\$|\$)', '［價格已隱藏］', 'g');

  -- price context label + number (or range); repeat to cover several per sentence
  FOR i IN 1..4 LOOP
    t := regexp_replace(
      t,
      '(價位|成本|均價|報價|目標價|履約價|短履約價|長履約價|停損價|停利價|油價|本金|最大損失|支撐|壓力)([^0-9\n]{0,8})[0-9][0-9,]*(\.[0-9]+)?(\s*[~～至到-]\s*[0-9][0-9,]*(\.[0-9]+)?)?',
      '\1\2［價格已隱藏］',
      'g'
    );
  END LOOP;

  -- price action verb + number (or range), year-safe
  t := regexp_replace(
    t,
    '(跌破|站上|突破|逼近|回測|上看|下看|守住|失守|上|破|至|到)\s*[0-9][0-9,]*(\.[0-9]+)?(\s*[~～]\s*[0-9][0-9,]*(\.[0-9]+)?)?(?![0-9%年月日號檔家人次])',
    '\1［價格已隱藏］',
    'g'
  );

  -- bare numeric ranges and decimals are price-like
  t := regexp_replace(t, '[0-9][0-9,]*(\.[0-9]+)?\s*[~～]\s*[0-9][0-9,]*(\.[0-9]+)?', '［價格已隱藏］', 'g');
  t := regexp_replace(t, '(?<![0-9])[0-9]+\.[0-9]+(?![0-9])', '［價格已隱藏］', 'g');

  -- residual numeric leakage -> fail closed (year tokens excluded)
  ry := regexp_replace(t, '(19|20)[0-9]{2}\s*年?', '', 'g');
  IF ry ~ '[0-9]{4,}' OR ry ~ '[0-9],[0-9]{3}' OR t ~ '[0-9]+\.[0-9]' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unclassified_numeric', 'text', '');
  END IF;
  IF t ~ '(跌破|站上|突破|逼近|履約價|油價|本金|最大損失|目標價|均價|成本|價位|報價|支撐|壓力)[^。\n]{0,12}[0-9]' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'residual_contextual_price', 'text', '');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', null, 'text', t);
END;
$$;

REVOKE ALL ON FUNCTION public.sample_redact_m1(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sample_redact_m1(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_redact_m1(text) TO service_role;

-- ── builder: normalize then redact; hash still over exact raw source ─────────
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
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'company_admin'::public.app_role) THEN
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
$$;

REVOKE ALL ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_expert_public_sample(uuid, date, jsonb) TO service_role;