-- =====================================================================
-- R1-P CLONE — exact production bodies + exact pre-cutover EXECUTE grants
-- for the 28 unique ACL targets of db/r1/p/acl-25.json.
-- Extracted read-only from production via pg_get_functiondef / aclexplode.
-- Loaded on disposable clones ONLY, so that 002_public_contract.sql has real
-- objects to close and 095/096 can run dynamic (not vacuous) proofs.
-- =====================================================================
SET check_function_bodies = off;

Output format is unaligned.
CREATE OR REPLACE FUNCTION public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_prop public.holdings_fix_proposals;
  v_result jsonb := '{}'::jsonb;
  v_ids uuid[];
BEGIN
  IF NOT public.has_role(v_uid, 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'confirmation required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.holdings_fix_proposals WHERE id = p_id FOR UPDATE;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found';
  END IF;
  IF v_prop.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal is not pending (status=%)', v_prop.status;
  END IF;

  BEGIN
    IF v_prop.proposed_action = 'normalize_unit' THEN
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_prop.payload->'signal_ids'))::uuid[] INTO v_ids;
      UPDATE public.expert_signals
         SET quantity_unit = v_prop.payload->>'target_unit'
       WHERE id = ANY(v_ids);
      v_result := jsonb_build_object('updated_signals', array_length(v_ids,1));

    ELSIF v_prop.proposed_action = 'adjust_trade_quantity' THEN
      UPDATE public.trade_records
         SET quantity = (v_prop.payload->>'to_quantity')::numeric
       WHERE id = (v_prop.payload->>'trade_id')::uuid;
      v_result := jsonb_build_object('updated_trade_id', v_prop.payload->>'trade_id');

    ELSIF v_prop.proposed_action = 'close_trade_record' THEN
      UPDATE public.trade_records
         SET status = 'closed', exit_date = COALESCE(exit_date, now())
       WHERE id = (v_prop.payload->>'trade_id')::uuid;
      v_result := jsonb_build_object('closed_trade_id', v_prop.payload->>'trade_id');

    ELSIF v_prop.proposed_action = 'cancel_signal' THEN
      DELETE FROM public.expert_signals
       WHERE id = (v_prop.payload->>'signal_id')::uuid
         AND status = 'pending';
      v_result := jsonb_build_object('deleted_signal_id', v_prop.payload->>'signal_id');

    ELSIF v_prop.proposed_action = 'manual_review' THEN
      RAISE EXCEPTION 'this proposal requires manual handling and cannot be auto-applied';
    ELSE
      RAISE EXCEPTION 'unsupported proposed_action %', v_prop.proposed_action;
    END IF;

    UPDATE public.holdings_fix_proposals
       SET status = 'applied',
           applied_by = v_uid,
           applied_at = now(),
           apply_result = v_result
     WHERE id = p_id;

    INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
    VALUES (v_uid, 'fix_proposal.apply', 'holdings_fix_proposals', p_id,
            jsonb_build_object('action', v_prop.proposed_action, 'payload', v_prop.payload, 'result', v_result));

  EXCEPTION WHEN OTHERS THEN
    UPDATE public.holdings_fix_proposals
       SET status = 'failed',
           applied_by = v_uid,
           applied_at = now(),
           apply_result = jsonb_build_object('error', SQLERRM)
     WHERE id = p_id;
    RAISE;
  END;

  RETURN v_result;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _deleted integer;
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- 授權：company_admin 或 呼叫者是 expert.user_id
  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE tr.signal_id = ANY(_signal_ids) AND e.user_id = _caller
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.trade_records WHERE signal_id = ANY(_signal_ids);
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_trade_records_by_symbol(_expert_id uuid, _symbol_prefix text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _deleted integer;
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF _symbol_prefix IS NULL OR length(trim(_symbol_prefix)) = 0 THEN
    RAISE EXCEPTION 'symbol_prefix required' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = _caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.trade_records
   WHERE expert_id = _expert_id
     AND instrument ILIKE (_symbol_prefix || '%');
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_generate_fix_proposals(p_category text DEFAULT NULL::text)
 RETURNS TABLE(inserted integer, superseded integer, total_pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted int := 0;
  v_superseded int := 0;
  v_total int := 0;
  r record;
  v_sig text;
  v_action text;
  v_payload jsonb;
  v_preview jsonb;
  v_summary text;
  v_expert_id uuid;
  v_canon_unit text;
  v_signal_ids uuid[];
  v_trade_id uuid;
  v_trade_qty numeric;
  v_trade_unit text;
BEGIN
  IF NOT public.has_role(v_uid, 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Supersede pending proposals so we start clean per generation
  UPDATE public.holdings_fix_proposals
     SET status = 'superseded', reviewed_by = v_uid, reviewed_at = now(),
         review_note = 'auto-superseded by regeneration'
   WHERE status = 'pending'
     AND (p_category IS NULL OR drift_category = p_category);
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  FOR r IN
    SELECT * FROM public.admin_holdings_consistency_audit()
     WHERE (p_category IS NULL OR category = p_category)
  LOOP
    SELECT id INTO v_expert_id FROM public.experts WHERE slug = r.expert_slug;

    v_action := NULL; v_payload := '{}'::jsonb; v_preview := '{}'::jsonb; v_summary := '';

    IF r.category IN ('UNIT_MIX') THEN
      -- canonical unit = latest trade_records unit for this expert+symbol; fallback to latest signal unit
      SELECT t.quantity_unit INTO v_canon_unit
        FROM public.trade_records t
       WHERE t.expert_id = v_expert_id
         AND regexp_replace(t.instrument, '\s.*$', '') = r.symbol
       ORDER BY t.created_at DESC LIMIT 1;
      IF v_canon_unit IS NULL THEN
        SELECT s.quantity_unit INTO v_canon_unit
          FROM public.expert_signals s
         WHERE s.expert_id = v_expert_id
           AND regexp_replace(s.instrument, '\s.*$', '') = r.symbol
         ORDER BY s.created_at DESC LIMIT 1;
      END IF;

      SELECT array_agg(s.id) INTO v_signal_ids
        FROM public.expert_signals s
       WHERE s.expert_id = v_expert_id
         AND regexp_replace(s.instrument, '\s.*$', '') = r.symbol
         AND s.quantity_unit IS DISTINCT FROM v_canon_unit;

      IF v_canon_unit IS NULL OR v_signal_ids IS NULL OR array_length(v_signal_ids,1) IS NULL THEN
        v_action := 'manual_review';
        v_summary := format('%s：偵測到單位混用但無法自動決定 canonical 單位', r.symbol);
      ELSE
        v_action := 'normalize_unit';
        v_summary := format('%s：將 %s 筆訊號單位改寫為「%s」（依最新持倉）', r.symbol, array_length(v_signal_ids,1), v_canon_unit);
        v_payload := jsonb_build_object(
          'target_unit', v_canon_unit,
          'signal_ids', to_jsonb(v_signal_ids),
          'also_scale_quantity', false
        );
        v_preview := jsonb_build_object(
          'units_seen', r.details->>'units_seen',
          'target_unit', v_canon_unit,
          'affected_signal_count', array_length(v_signal_ids,1)
        );
      END IF;

    ELSIF r.category = 'DRIFT_A_VS_B' THEN
      SELECT t.id, t.quantity, t.quantity_unit INTO v_trade_id, v_trade_qty, v_trade_unit
        FROM public.trade_records t
       WHERE t.expert_id = v_expert_id
         AND regexp_replace(t.instrument, '\s.*$', '') = r.symbol
         AND t.status = 'open'
       ORDER BY t.created_at DESC LIMIT 1;
      IF v_trade_id IS NULL THEN
        v_action := 'manual_review';
        v_summary := format('%s：帳面部位與訊號淨額不符，且找不到 open 部位', r.symbol);
      ELSE
        DECLARE
          v_net_shares numeric := (r.details->>'signal_net_shares')::numeric;
          v_target_qty numeric;
        BEGIN
          v_target_qty := CASE WHEN v_trade_unit = '張' THEN v_net_shares / 1000.0 ELSE v_net_shares END;
          v_action := 'adjust_trade_quantity';
          v_summary := format('%s：持倉 %s %s → 建議 %s %s（比對訊號淨額）', r.symbol, v_trade_qty, v_trade_unit, v_target_qty, v_trade_unit);
          v_payload := jsonb_build_object(
            'trade_id', v_trade_id,
            'from_quantity', v_trade_qty,
            'to_quantity', v_target_qty,
            'unit', v_trade_unit
          );
          v_preview := jsonb_build_object(
            'before', jsonb_build_object('quantity', v_trade_qty, 'unit', v_trade_unit),
            'after', jsonb_build_object('quantity', v_target_qty, 'unit', v_trade_unit),
            'signal_net_shares', v_net_shares
          );
        END;
      END IF;

    ELSIF r.category = 'ORPHAN_PENDING' THEN
      v_action := 'cancel_signal';
      v_summary := format('%s：pending 訊號超過 %s 天，建議刪除', r.symbol, r.details->>'age_days');
      v_payload := jsonb_build_object('signal_id', r.details->>'signal_id');
      v_preview := jsonb_build_object('signal', r.details);

    ELSIF r.category = 'ORPHAN_TRADE' THEN
      SELECT t.id, t.quantity, t.quantity_unit INTO v_trade_id, v_trade_qty, v_trade_unit
        FROM public.trade_records t
       WHERE t.expert_id = v_expert_id
         AND regexp_replace(t.instrument, '\s.*$', '') = r.symbol
         AND t.status = 'open'
       ORDER BY t.created_at DESC LIMIT 1;
      IF v_trade_id IS NULL THEN
        v_action := 'manual_review';
        v_summary := format('%s：找不到對應的 open 部位可平倉', r.symbol);
      ELSE
        v_action := 'close_trade_record';
        v_summary := format('%s：訊號已賣光，建議將持倉標記為 closed', r.symbol);
        v_payload := jsonb_build_object('trade_id', v_trade_id);
        v_preview := jsonb_build_object('before_status', 'open', 'after_status', 'closed', 'quantity', v_trade_qty, 'unit', v_trade_unit);
      END IF;

    ELSE
      -- UNIT_A_NE_B / HIDDEN_ACTIONS / ORPHAN_SIGNAL and others
      v_action := 'manual_review';
      v_summary := format('%s：%s 需人工判斷', COALESCE(r.symbol, r.expert_slug), r.category);
      v_preview := r.details;
    END IF;

    v_sig := r.category || '|' || COALESCE(r.expert_slug,'-') || '|' || COALESCE(r.symbol,'-')
             || '|' || md5(v_payload::text);

    INSERT INTO public.holdings_fix_proposals(
      drift_category, expert_id, expert_slug, expert_name, symbol, instrument,
      severity, summary, proposed_action, payload, preview, status, signature,
      generated_by
    ) VALUES (
      r.category, v_expert_id, r.expert_slug, r.expert_name, r.symbol, r.symbol,
      r.severity, v_summary, v_action, v_payload, v_preview, 'pending', v_sig,
      v_uid
    )
    ON CONFLICT (signature) DO UPDATE
      SET status = 'pending',
          summary = EXCLUDED.summary,
          payload = EXCLUDED.payload,
          preview = EXCLUDED.preview,
          severity = EXCLUDED.severity,
          generated_by = v_uid,
          generated_at = now(),
          reviewed_by = NULL,
          reviewed_at = NULL,
          review_note = NULL,
          applied_by = NULL,
          applied_at = NULL,
          apply_result = NULL;
    v_inserted := v_inserted + 1;
  END LOOP;

  SELECT count(*) INTO v_total FROM public.holdings_fix_proposals WHERE status = 'pending';

  INSERT INTO public.audit_logs(actor_id, action, target_type, detail)
  VALUES (v_uid, 'fix_proposals.generate', 'holdings_fix_proposals',
          jsonb_build_object('inserted', v_inserted, 'superseded', v_superseded, 'category', p_category));

  RETURN QUERY SELECT v_inserted, v_superseded, v_total;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_holdings_consistency_audit()
 RETURNS TABLE(category text, expert_slug text, expert_name text, symbol text, severity text, details jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  -- 1. ORPHAN_PENDING
  SELECT
    'ORPHAN_PENDING'::text,
    e.slug, e.name,
    s.instrument,
    CASE WHEN s.created_at < now() - interval '30 days' THEN 'high' ELSE 'medium' END,
    jsonb_build_object(
      'signal_id', s.id,
      'action', s.action,
      'quantity', s.quantity,
      'unit', s.quantity_unit,
      'created_at', s.created_at,
      'age_days', extract(day from (now() - s.created_at))::int
    )
  FROM expert_signals s
  JOIN experts e ON e.id = s.expert_id
  WHERE s.status = 'pending'
    AND s.created_at < now() - interval '7 days'
    AND s.action <> 'teaching';

  RETURN QUERY
  -- 2. UNIT_MIX
  WITH sig_units AS (
    SELECT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.quantity_unit AS unit
    FROM expert_signals s
    WHERE s.status = 'published' AND s.action <> 'teaching' AND s.quantity IS NOT NULL AND s.quantity <> 0
  ),
  tr_units AS (
    SELECT t.expert_id,
           regexp_replace(t.instrument, '\s.*$', '') AS symbol,
           t.quantity_unit AS unit
    FROM trade_records t
  ),
  all_units AS (
    SELECT * FROM sig_units UNION ALL SELECT * FROM tr_units
  )
  SELECT
    'UNIT_MIX'::text,
    e.slug, e.name, u.symbol,
    'high'::text,
    jsonb_build_object(
      'units_seen', string_agg(DISTINCT u.unit, ' | ' ORDER BY u.unit),
      'variants', count(DISTINCT u.unit)
    )
  FROM all_units u
  JOIN experts e ON e.id = u.expert_id
  GROUP BY e.slug, e.name, u.symbol
  HAVING count(DISTINCT u.unit) > 1;

  RETURN QUERY
  -- 3. DRIFT_A_VS_B
  WITH sig_norm AS (
    SELECT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.action,
           (s.quantity * CASE WHEN s.quantity_unit = '張' THEN 1000 ELSE 1 END) AS shares
    FROM expert_signals s
    WHERE s.status='published' AND s.quantity IS NOT NULL
      AND s.action IN ('buy','add','sell','trim','exit')
  ),
  sig_agg AS (
    SELECT expert_id, symbol,
      SUM(CASE WHEN action IN ('buy','add') THEN shares ELSE 0 END) AS buy_shares,
      SUM(CASE WHEN action IN ('sell','trim','exit') THEN shares ELSE 0 END) AS sell_shares
    FROM sig_norm GROUP BY expert_id, symbol
  ),
  tr_open AS (
    SELECT t.expert_id,
           regexp_replace(t.instrument, '\s.*$', '') AS symbol,
           SUM(t.quantity * CASE WHEN t.quantity_unit='張' THEN 1000 ELSE 1 END) AS open_shares
    FROM trade_records t WHERE t.status='open'
    GROUP BY t.expert_id, symbol
  ),
  merged AS (
    SELECT COALESCE(s.expert_id, o.expert_id) AS expert_id,
           COALESCE(s.symbol, o.symbol) AS symbol,
           COALESCE(s.buy_shares,0) AS b_buy,
           COALESCE(s.sell_shares,0) AS b_sell,
           COALESCE(s.buy_shares,0)-COALESCE(s.sell_shares,0) AS b_net,
           COALESCE(o.open_shares,0) AS a_open
    FROM sig_agg s FULL OUTER JOIN tr_open o USING (expert_id, symbol)
  )
  SELECT
    'DRIFT_A_VS_B'::text,
    e.slug, e.name, m.symbol,
    CASE WHEN abs(m.a_open - m.b_net) >= 10000 THEN 'high'
         WHEN abs(m.a_open - m.b_net) >= 1000  THEN 'medium'
         ELSE 'low' END,
    jsonb_build_object(
      'trade_open_shares', m.a_open,
      'signal_net_shares', m.b_net,
      'signal_buy_shares', m.b_buy,
      'signal_sell_shares', m.b_sell,
      'drift_shares', m.a_open - m.b_net
    )
  FROM merged m
  JOIN experts e ON e.id = m.expert_id
  WHERE (m.a_open - m.b_net) <> 0;

  RETURN QUERY
  -- 4. HIDDEN_ACTIONS
  WITH sig_norm AS (
    SELECT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.action,
           (s.quantity * CASE WHEN s.quantity_unit='張' THEN 1000 ELSE 1 END) AS shares
    FROM expert_signals s
    WHERE s.status='published' AND s.quantity IS NOT NULL
      AND s.action IN ('add','trim','exit')
  )
  SELECT
    'HIDDEN_ACTIONS'::text,
    e.slug, e.name, n.symbol,
    'medium'::text,
    jsonb_build_object(
      'add_shares',  SUM(CASE WHEN action='add'  THEN shares ELSE 0 END),
      'trim_shares', SUM(CASE WHEN action='trim' THEN shares ELSE 0 END),
      'exit_shares', SUM(CASE WHEN action='exit' THEN shares ELSE 0 END),
      'hidden_net_shares', SUM(CASE WHEN action='add' THEN shares ELSE -shares END)
    )
  FROM sig_norm n
  JOIN experts e ON e.id = n.expert_id
  GROUP BY e.slug, e.name, n.symbol
  HAVING SUM(CASE WHEN action='add' THEN shares ELSE -shares END) <> 0;

  RETURN QUERY
  -- 5. UNIT_A_NE_B
  WITH sig_units AS (
    SELECT DISTINCT s.expert_id,
           regexp_replace(s.instrument, '\s.*$', '') AS symbol,
           s.quantity_unit AS sig_unit
    FROM expert_signals s
    WHERE s.status='published' AND s.action <> 'teaching' AND s.quantity IS NOT NULL AND s.quantity <> 0
  ),
  tr_units AS (
    SELECT DISTINCT t.expert_id,
           regexp_replace(t.instrument, '\s.*$', '') AS symbol,
           t.quantity_unit AS tr_unit
    FROM trade_records t
  )
  SELECT
    'UNIT_A_NE_B'::text,
    e.slug, e.name, s.symbol,
    'high'::text,
    jsonb_build_object(
      'signal_units', string_agg(DISTINCT s.sig_unit, ',' ORDER BY s.sig_unit),
      'trade_units',  string_agg(DISTINCT t.tr_unit,  ',' ORDER BY t.tr_unit)
    )
  FROM sig_units s
  JOIN tr_units  t USING (expert_id, symbol)
  JOIN experts   e ON e.id = s.expert_id
  GROUP BY e.slug, e.name, s.symbol
  HAVING string_agg(DISTINCT s.sig_unit,',' ORDER BY s.sig_unit)
      <> string_agg(DISTINCT t.tr_unit, ',' ORDER BY t.tr_unit);

  RETURN QUERY
  -- 6. ORPHAN_TRADE
  WITH sig_buy AS (
    SELECT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM expert_signals WHERE status='published' AND action IN ('buy','add')
  ),
  tr_open AS (
    SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM trade_records WHERE status='open'
  )
  SELECT 'ORPHAN_TRADE'::text, e.slug, e.name, o.symbol, 'high'::text, '{}'::jsonb
  FROM tr_open o
  JOIN experts e ON e.id = o.expert_id
  LEFT JOIN sig_buy b USING (expert_id, symbol)
  WHERE b.symbol IS NULL;

  RETURN QUERY
  -- 7. ORPHAN_SIGNAL
  WITH sig_buy AS (
    SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM expert_signals WHERE status='published' AND action IN ('buy','add')
  ),
  tr_any AS (
    SELECT DISTINCT expert_id, regexp_replace(instrument, '\s.*$', '') AS symbol
    FROM trade_records
  )
  SELECT 'ORPHAN_SIGNAL'::text, e.slug, e.name, s.symbol, 'medium'::text, '{}'::jsonb
  FROM sig_buy s
  JOIN experts e ON e.id = s.expert_id
  LEFT JOIN tr_any t USING (expert_id, symbol)
  WHERE t.symbol IS NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_list_cron_jobs()
 RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, active boolean, database text, username text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
  SELECT j.jobid, j.jobname, j.schedule, j.command, j.active, j.database, j.username
  FROM cron.job j
  ORDER BY j.jobname NULLS LAST, j.jobid;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_reject_fix_proposal(p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'company_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.holdings_fix_proposals
     SET status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal not found or not pending'; END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (v_uid, 'fix_proposal.reject', 'holdings_fix_proposals', p_id,
          jsonb_build_object('note', p_note));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_reset_expert_asset_class(_expert_id uuid, _new_asset_class text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _archived_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION '權限不足：只有 company_admin 可以重置分析師資產類別'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _new_asset_class NOT IN ('tw_stock','us_stock','crypto','us_option','us_future') THEN
    RAISE EXCEPTION '不支援的資產類別：%', _new_asset_class
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.bypass_asset_class_lock', 'on', true);

  UPDATE public.expert_signals
     SET status = 'archived'
   WHERE expert_id = _expert_id
     AND status <> 'archived';
  GET DIAGNOSTICS _archived_count = ROW_COUNT;

  UPDATE public.experts
     SET asset_class    = _new_asset_class,
         starting_capital = NULL
   WHERE id = _expert_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, meta)
  VALUES (
    auth.uid(),
    'admin_reset_expert_asset_class',
    'experts',
    _expert_id,
    jsonb_build_object(
      'new_asset_class', _new_asset_class,
      'archived_signals', _archived_count
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_trade_dedupe_sweep(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.trade_dedupe_sweep(p_dry_run);
END
$function$
;

CREATE OR REPLACE FUNCTION public.backfill_job_set_done(_id bigint, _status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.backfill_job_queue
  SET status = _status,
      updated_at = now(),
      fulfilled_at = CASE WHEN _status IN ('done','skipped') THEN now() ELSE fulfilled_at END
  WHERE id = _id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.backfill_job_set_failed(_id bigint, _error text, _retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  job public.backfill_job_queue;
BEGIN
  SELECT * INTO job FROM public.backfill_job_queue WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;

  IF job.attempts >= job.max_attempts THEN
    UPDATE public.backfill_job_queue
    SET status = 'failed',
        last_error = _error,
        updated_at = now()
    WHERE id = _id;
  ELSE
    UPDATE public.backfill_job_queue
    SET status = 'pending',
        last_error = _error,
        next_run_at = COALESCE(_retry_at, now() + (interval '1 minute' * (job.attempts + 1))),
        updated_at = now()
    WHERE id = _id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.backfill_legacy_bsr_to_fact(_from date, _to date)
 RETURNS TABLE(inserted_rows integer, skipped_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
  v_total int := 0;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Invalid date range: % to %', _from, _to;
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.tw_bsr_daily
  WHERE trade_date BETWEEN _from AND _to;

  PERFORM set_config('app.force_reseal', 'true', true);

  WITH ins AS (
    INSERT INTO public.tw_chip_fact (
      stock_id, trade_date, broker_id, broker_name, source,
      buy_shares, sell_shares,
      avg_buy_price, avg_sell_price, ingested_at
    )
    SELECT
      stock_id, trade_date, broker_id, broker_name,
      'legacy_migration'::text,
      buy_shares, sell_shares,
      avg_buy_price, avg_sell_price,
      COALESCE(created_at, now())
    FROM public.tw_bsr_daily
    WHERE trade_date BETWEEN _from AND _to
    ON CONFLICT (stock_id, trade_date, broker_id, source) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  PERFORM set_config('app.force_reseal', 'false', true);

  RETURN QUERY SELECT v_inserted, GREATEST(v_total - v_inserted, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.backfill_queue_stats()
 RETURNS TABLE(dataset text, pending bigint, running bigint, done bigint, failed bigint, skipped bigint, oldest_pending timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(j.dataset, 'total') AS dataset,
    SUM(CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN j.status = 'running' THEN 1 ELSE 0 END) AS running,
    SUM(CASE WHEN j.status = 'done' THEN 1 ELSE 0 END) AS done,
    SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN j.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
    MIN(CASE WHEN j.status = 'pending' THEN j.created_at ELSE NULL END) AS oldest_pending
  FROM public.backfill_job_queue j
  GROUP BY ROLLUP(j.dataset)
  ORDER BY dataset NULLS LAST;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_backfill_jobs(_batch_size integer DEFAULT 1, _max_priority_score integer DEFAULT NULL::integer)
 RETURNS TABLE(id bigint, dataset text, stock_id text, start_date date, end_date date, source_hint text, payload jsonb, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  now_ts TIMESTAMPTZ := now();
BEGIN
  PERFORM public.recover_stale_backfill_jobs(interval '15 minutes');

  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.backfill_job_queue q
    WHERE q.status = 'pending'
      AND q.next_run_at <= now_ts
      AND (_max_priority_score IS NULL OR q.priority_score <= _max_priority_score)
    ORDER BY q.priority_score DESC, q.next_run_at ASC, q.id ASC
    LIMIT GREATEST(1, LEAST(COALESCE(_batch_size, 1), 10))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.backfill_job_queue q
  SET status = 'running',
      updated_at = now_ts,
      attempts = q.attempts + 1,
      last_error = NULL
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.id, q.dataset, q.stock_id, q.start_date, q.end_date, q.source_hint, q.payload, q.attempts;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_backfill_jobs(_jobs jsonb)
 RETURNS TABLE(inserted integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted INTEGER := 0;
  v_skipped INTEGER := 0;
  job RECORD;
BEGIN
  FOR job IN
    SELECT
      (j->>'dataset')::TEXT AS dataset,
      (j->>'stock_id')::TEXT AS stock_id,
      (j->>'start_date')::DATE AS start_date,
      (j->>'end_date')::DATE AS end_date,
      COALESCE((j->>'priority_score')::INTEGER, 0) AS priority_score,
      COALESCE((j->>'source_hint')::TEXT, 'finmind') AS source_hint,
      COALESCE((j->>'max_attempts')::INTEGER, 3) AS max_attempts,
      COALESCE(j->'payload', '{}'::JSONB) AS payload
    FROM jsonb_array_elements(_jobs) AS j
  LOOP
    INSERT INTO public.backfill_job_queue (
      dataset, stock_id, start_date, end_date, priority_score,
      source_hint, max_attempts, payload, status
    )
    VALUES (
      job.dataset, job.stock_id, job.start_date, job.end_date, job.priority_score,
      job.source_hint, job.max_attempts, job.payload, 'pending'
    )
    ON CONFLICT (dataset, stock_id, start_date, end_date, source_hint)
    WHERE status IN ('pending','running')
    DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_skipped;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(p_stock_id text, p_days integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_d date;
  v_inserted int := 0;
  v_count int := 0;
  v_row_ct int;
  v_max_days int := LEAST(GREATEST(p_days, 1), 120);
BEGIN
  IF p_stock_id IS NULL OR p_stock_id !~ '^[1-9][0-9]{3}$' THEN
    RAISE EXCEPTION 'invalid stock_id (must be 4-digit code starting 1-9)';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT public.has_role(v_uid, 'company_admin') INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE (regexp_match(COALESCE(tr.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] = p_stock_id
        AND e.user_id = v_uid
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      -- 只看「自己」的持倉列；解析 array 與 {holdings:[]} 兩種形狀
      SELECT EXISTS (
        SELECT 1
          FROM public.checkup_storage cs,
               LATERAL jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
                   WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
                   ELSE '[]'::jsonb
                 END
               ) h
         WHERE cs.user_id = v_uid
           AND cs.key LIKE 'pf-holdings%'
           AND upper(btrim(COALESCE(h->>'code', h->>'symbol'))) = p_stock_id
      ) INTO v_is_owner;
    END IF;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'not authorized to backfill this stock';
    END IF;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < v_max_days LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES (p_stock_id, v_d, 1, 'pending', now(), 'backfill_rpc', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_row_ct = ROW_COUNT;
      v_inserted := v_inserted + v_row_ct;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 200;
  END LOOP;

  RETURN v_inserted;
END; $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_institutional_backfill_universe()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n INT;
BEGIN
  WITH cov AS (
    SELECT stock_id, COUNT(DISTINCT trade_date) AS d
      FROM public.tw_institutional_daily
     GROUP BY stock_id
  ),
  saved AS (
    SELECT DISTINCT upper(btrim(COALESCE(h->>'code', h->>'symbol'))) AS sid
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
               WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
               ELSE '[]'::jsonb
             END
           ) h
     WHERE cs.key LIKE 'pf-holdings%'
  ),
  open_pos AS (
    SELECT DISTINCT sid FROM (
      SELECT SPLIT_PART(TRIM(tr.instrument), ' ', 1) AS sid
        FROM public.trade_records tr
       WHERE tr.market = 'TW' AND tr.status::text = 'open'
      UNION
      SELECT SPLIT_PART(TRIM(es.instrument), ' ', 1)
        FROM public.expert_signals es
       WHERE es.market = 'TW'
    ) x
  ),
  others AS (
    SELECT DISTINCT u.code AS sid
      FROM public.checkup_prefetch_universe() u
     WHERE u.supported
    UNION
    SELECT DISTINCT stock_id FROM public.v_active_tw_holdings
  ),
  r1 AS (SELECT sid FROM saved WHERE sid ~ '^[1-9][0-9]{3}$'),
  r2 AS (
    SELECT sid FROM open_pos
     WHERE sid ~ '^[1-9][0-9]{3}$'
       AND sid NOT IN (SELECT sid FROM r1)
  ),
  r3 AS (
    SELECT sid FROM others
     WHERE sid ~ '^[1-9][0-9]{3}$'
       AND sid NOT IN (SELECT sid FROM r1)
       AND sid NOT IN (SELECT sid FROM r2)
  ),
  elig AS (
    SELECT c.sid, c.rnk
      FROM (
        SELECT sid, 1 AS rnk FROM r1
        UNION ALL SELECT sid, 2 FROM r2
        UNION ALL SELECT sid, 3 FROM r3
      ) c
      LEFT JOIN cov ON cov.stock_id = c.sid
      LEFT JOIN public.institutional_new_stock_queue q ON q.stock_id = c.sid
     WHERE COALESCE(cov.d, 0) < 40
       AND (
         q.stock_id IS NULL
         OR (
           q.status IN ('failed', 'dead')
           AND q.attempts < 5
           AND q.next_attempt_at <= now()
           AND COALESCE(q.last_error, '') !~* '(no_data|delisted|ineligible|sealed|terminal)'
         )
       )
  ),
  cand AS (
        (SELECT sid FROM elig WHERE rnk = 1 ORDER BY sid LIMIT 20)
    UNION ALL
        (SELECT sid FROM elig WHERE rnk = 2 ORDER BY sid LIMIT 15)
    UNION ALL
        (SELECT sid FROM elig WHERE rnk = 3 ORDER BY sid LIMIT 5)
  ),
  ins AS (
    INSERT INTO public.institutional_new_stock_queue (stock_id, status, attempts, next_attempt_at)
    SELECT sid, 'pending', 0, now() FROM cand
    ON CONFLICT (stock_id) DO UPDATE
       SET status = 'pending',
           next_attempt_at = now() + LEAST(
             interval '24 hours',
             make_interval(mins => (30 * power(2, LEAST(public.institutional_new_stock_queue.attempts, 10)))::int)
           ),
           updated_at = now()
       WHERE public.institutional_new_stock_queue.status IN ('failed', 'dead')
         AND public.institutional_new_stock_queue.attempts < 5
         AND public.institutional_new_stock_queue.next_attempt_at <= now()
         AND COALESCE(public.institutional_new_stock_queue.last_error, '') !~* '(no_data|delisted|ineligible|sealed|terminal)'
    RETURNING 1
  )
  SELECT COUNT(*) INTO _n FROM ins;
  RETURN _n;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_expert_capital_status(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_starting numeric := 0;
  v_realized numeric := 0;
  v_open_cost numeric := 0;
  v_open_market numeric := 0;
  v_available numeric := 0;
  v_positions jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_expert_currency text := 'TWD';
  v_expert_asset_class text := 'tw_stock';
BEGIN
  SELECT
    COALESCE(starting_capital, 0),
    COALESCE(NULLIF(currency, ''), 'TWD'),
    COALESCE(NULLIF(asset_class, ''), CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
  INTO v_starting, v_expert_currency, v_expert_asset_class
  FROM public.experts
  WHERE id = _expert_id;

  SELECT COALESCE(SUM(
    COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
  ), 0)
  INTO v_realized
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed','stopped');

  SELECT COALESCE(SUM(COALESCE(quantity,0) * COALESCE(entry_price,0)), 0),
         COALESCE(SUM(COALESCE(quantity,0) * COALESCE(
           (SELECT price FROM public.current_prices cp
            WHERE cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
            LIMIT 1),
           tr.current_price, tr.entry_price, 0)), 0)
  INTO v_open_cost, v_open_market
  FROM public.trade_records tr
  WHERE expert_id = _expert_id AND status = 'open';

  v_available := v_starting + v_realized - v_open_cost;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tr.id,
    'instrument', tr.instrument,
    'symbol', SPLIT_PART(tr.instrument, ' ', 1),
    'quantity_shares', tr.quantity,
    'quantity_unit', COALESCE(NULLIF(tr.quantity_unit, ''), CASE
      WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class IN ('us_future', 'us_option') THEN '口'
      WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class = 'crypto' THEN '顆'
      ELSE '股'
    END),
    'market', COALESCE(NULLIF(tr.market, ''), CASE WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD' THEN 'US' ELSE 'TW' END),
    'currency', COALESCE(NULLIF(tr.currency, ''), v_expert_currency),
    'asset_class', CASE
      WHEN COALESCE(NULLIF(tr.currency, ''), v_expert_currency) = 'USD' THEN COALESCE(NULLIF(v_expert_asset_class, ''), 'us_stock')
      ELSE 'tw_stock'
    END,
    'entry_price', tr.entry_price,
    'entry_date', tr.entry_date,
    'current_price', COALESCE(cp.price, tr.current_price, tr.entry_price),
    'market_value', ROUND(COALESCE(tr.quantity,0) * COALESCE(cp.price, tr.current_price, tr.entry_price, 0), 0),
    'cost_value', ROUND(COALESCE(tr.quantity,0) * COALESCE(tr.entry_price,0), 0),
    'unrealized_pnl', ROUND(COALESCE(tr.quantity,0) * (COALESCE(cp.price, tr.current_price, tr.entry_price, 0) - COALESCE(tr.entry_price,0)), 0),
    'unrealized_pct', CASE WHEN COALESCE(tr.entry_price,0) > 0
      THEN ROUND(((COALESCE(cp.price, tr.current_price, tr.entry_price, 0) - tr.entry_price) / tr.entry_price) * 100, 2)
      ELSE 0 END
  ) ORDER BY tr.created_at DESC), '[]'::jsonb)
  INTO v_positions
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id AND tr.status = 'open';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'instrument', instrument,
    'symbol', SPLIT_PART(instrument, ' ', 1),
    'status', status,
    'quantity_shares', quantity,
    'quantity_unit', COALESCE(NULLIF(quantity_unit, ''), CASE
      WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class IN ('us_future', 'us_option') THEN '口'
      WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD'
        AND v_expert_asset_class = 'crypto' THEN '顆'
      ELSE '股'
    END),
    'market', COALESCE(NULLIF(market, ''), CASE WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD' THEN 'US' ELSE 'TW' END),
    'currency', COALESCE(NULLIF(currency, ''), v_expert_currency),
    'asset_class', CASE
      WHEN COALESCE(NULLIF(currency, ''), v_expert_currency) = 'USD' THEN COALESCE(NULLIF(v_expert_asset_class, ''), 'us_stock')
      ELSE 'tw_stock'
    END,
    'entry_price', entry_price,
    'entry_date', entry_date,
    'exit_price', exit_price,
    'exit_date', exit_date,
    'pnl_percent', pnl_percent,
    'created_at', created_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT * FROM public.trade_records
    WHERE expert_id = _expert_id
    ORDER BY created_at DESC
    LIMIT 20
  ) sub;

  RETURN jsonb_build_object(
    'starting_capital', ROUND(v_starting, 0),
    'realized_pnl_amount', ROUND(v_realized, 0),
    'open_cost_value', ROUND(v_open_cost, 0),
    'open_market_value', ROUND(v_open_market, 0),
    'unrealized_pnl_amount', ROUND(v_open_market - v_open_cost, 0),
    'available_cash', ROUND(v_available, 0),
    'currency', v_expert_currency,
    'asset_class', v_expert_asset_class,
    'open_positions', v_positions,
    'recent_trades', v_recent
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_publish_batch_attempts(_limit integer DEFAULT 60)
 RETURNS TABLE(id uuid, market text, attempt_no integer, max_attempts integer, status text, scheduled_at timestamp with time zone, next_retry_at timestamp with time zone, started_at timestamp with time zone, finished_at timestamp with time zone, duration_ms integer, run_id text, parent_attempt_id uuid, root_attempt_id uuid, error_message text, response jsonb, trigger_source text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT
      a.id, a.market, a.attempt_no, a.max_attempts, a.status,
      a.scheduled_at, a.next_retry_at, a.started_at, a.finished_at,
      CASE WHEN a.started_at IS NOT NULL AND a.finished_at IS NOT NULL
           THEN (EXTRACT(EPOCH FROM (a.finished_at - a.started_at))*1000)::int
           ELSE NULL END AS duration_ms,
      a.run_id, a.parent_attempt_id, a.root_attempt_id,
      a.error_message, a.response, a.trigger_source, a.created_at
    FROM public.publish_batch_attempts a
    ORDER BY a.created_at DESC
    LIMIT LEAST(GREATEST(_limit,1), 500);
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_publish_batch_runs(_limit integer DEFAULT 20)
 RETURNS TABLE(run_id text, started_at timestamp with time zone, ended_at timestamp with time zone, market text, pending_found integer, published integer, failed integer, pushed integer, push_fail integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT l.run_id, l.created_at, l.stage, l.msg
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.created_at >= now() - interval '14 days'
  ),
  runs AS (
    SELECT run_id,
           min(created_at) AS started_at,
           max(created_at) AS ended_at,
           max(CASE WHEN stage='filter_by_market' THEN split_part(msg,' ',3) END) AS market_raw,
           max(CASE WHEN stage='fetch_pending_signals'
                    THEN (regexp_matches(msg,'Found (\d+)'))[1]::int END) AS pending_found,
           max(CASE WHEN stage='mark_published'
                    THEN (regexp_matches(msg,'Published (\d+)/'))[1]::int END) AS published,
           max(CASE WHEN stage='mark_published'
                    THEN (regexp_matches(msg,'failed=(\d+)'))[1]::int END) AS failed,
           max(CASE WHEN stage='line_push'
                    THEN (regexp_matches(msg,'pushed=(\d+)'))[1]::int END) AS pushed,
           max(CASE WHEN stage='line_push'
                    THEN (regexp_matches(msg,'pushFail=(\d+)'))[1]::int END) AS push_fail
    FROM src
    GROUP BY run_id
  )
  SELECT r.run_id, r.started_at, r.ended_at,
         CASE WHEN r.market_raw ILIKE 'US%' THEN 'US'
              WHEN r.market_raw ILIKE 'TW%' THEN 'TW'
              ELSE 'ALL' END,
         COALESCE(r.pending_found,0),
         COALESCE(r.published,0),
         COALESCE(r.failed,0),
         COALESCE(r.pushed,0),
         COALESCE(r.push_fail,0)
  FROM runs r
  ORDER BY r.started_at DESC
  LIMIT _limit;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_publish_batch_status()
 RETURNS TABLE(expert_id uuid, expert_name text, expert_slug text, market text, asset_class text, pending_count integer, published_this_week integer, failed_pending_count integer, last_attempt_at timestamp with time zone, last_error_kind text, last_error_msg text, last_error_signal_id uuid, last_run_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH us_classes AS (
    SELECT unnest(ARRAY['us_stock','us_futures','crypto']) AS c
  ),
  base AS (
    SELECT e.id, e.name, e.expert_slug, e.asset_class,
           CASE WHEN lower(e.asset_class) IN (SELECT c FROM us_classes)
                THEN 'US' ELSE 'TW' END AS mk
    FROM public.experts e
  ),
  sig_stats AS (
    SELECT s.expert_id,
           count(*) FILTER (WHERE s.status='pending')::int AS pending_count,
           count(*) FILTER (
             WHERE s.status='published'
               AND s.updated_at >= now() - interval '7 days'
           )::int AS published_this_week
    FROM public.expert_signals s
    WHERE s.updated_at >= now() - interval '14 days' OR s.status='pending'
    GROUP BY s.expert_id
  ),
  err_logs AS (
    SELECT l.expert_id, l.signal_id, l.msg, l.run_id, l.created_at,
           l.payload->>'kind' AS kind
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.stage='mark_published_iter'
      AND l.level='error'
      AND l.expert_id IS NOT NULL
      AND l.created_at >= now() - interval '14 days'
  ),
  latest_err AS (
    SELECT DISTINCT ON (expert_id)
           expert_id, created_at AS last_attempt_at, kind AS last_error_kind,
           msg AS last_error_msg, signal_id AS last_error_signal_id, run_id AS last_run_id
    FROM err_logs
    ORDER BY expert_id, created_at DESC
  ),
  failed_pending AS (
    SELECT el.expert_id, count(DISTINCT el.signal_id)::int AS cnt
    FROM err_logs el
    JOIN public.expert_signals s ON s.id = el.signal_id AND s.status='pending'
    GROUP BY el.expert_id
  )
  SELECT b.id, b.name, b.expert_slug, b.mk, b.asset_class,
         COALESCE(ss.pending_count,0),
         COALESCE(ss.published_this_week,0),
         COALESCE(fp.cnt,0),
         le.last_attempt_at, le.last_error_kind, le.last_error_msg,
         le.last_error_signal_id, le.last_run_id
  FROM base b
  LEFT JOIN sig_stats ss ON ss.expert_id = b.id
  LEFT JOIN latest_err le ON le.expert_id = b.id
  LEFT JOIN failed_pending fp ON fp.expert_id = b.id
  WHERE COALESCE(ss.pending_count,0) > 0
     OR COALESCE(ss.published_this_week,0) > 0
     OR le.last_attempt_at IS NOT NULL
  ORDER BY b.mk, b.name;
END $function$
;

CREATE OR REPLACE FUNCTION public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone)
 RETURNS TABLE(expert_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  JOIN public.experts e ON e.id = ep.expert_id
  WHERE ms.user_id = _user_id
    AND public.signal_in_subscription_window(e.role, ms.started_at, ms.expires_at, _published_at)
    -- 且該使用者目前對此老師仍有 active 訂閱（付費牆：斷約後失去存取，續訂即解鎖歷史）
    AND EXISTS (
      SELECT 1
      FROM public.member_subscriptions ms2
      JOIN public.expert_plans ep2 ON ep2.id = ms2.plan_id
      WHERE ms2.user_id = _user_id
        AND ep2.expert_id = ep.expert_id
        AND ms2.status = 'active'
        AND (ms2.expires_at IS NULL OR ms2.expires_at > now())
    )
$function$
;

CREATE OR REPLACE FUNCTION public.is_tester(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT is_tester FROM public.profiles WHERE user_id = _user_id LIMIT 1),
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.prune_backfill_job_queue()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DELETE FROM public.backfill_job_queue
  WHERE updated_at < now() - interval '30 days';
$function$
;

CREATE OR REPLACE FUNCTION public.publish_batch_attempts_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.recover_stale_backfill_jobs(_stale_after interval DEFAULT '00:15:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  recovered_count INTEGER := 0;
  now_ts TIMESTAMPTZ := now();
BEGIN
  IF _stale_after < interval '0 seconds' THEN
    RAISE EXCEPTION '_stale_after must be non-negative';
  END IF;

  UPDATE public.backfill_job_queue
  SET status = 'pending',
      last_error = 'STALE_RUNNING_RECOVERED',
      next_run_at = now_ts,
      updated_at = now_ts
  WHERE status = 'running'
    AND updated_at < now_ts - _stale_after;

  GET DIAGNOSTICS recovered_count = ROW_COUNT;
  RETURN recovered_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tg_holdings_fix_proposals_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.trade_dedupe_sweep(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id text := gen_random_uuid()::text;
  v_scanned int := 0;
  v_auto_fixed int := 0;
  v_needs_review int := 0;
  v_removed_total int := 0;
  v_manual_list jsonb := '[]'::jsonb;
  v_alert_id uuid;
  r record;
  v_keep uuid;
  v_remove uuid[];
BEGIN
  INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, payload)
  VALUES ('trade_dedupe_sweep', v_run_id, 'info', 'start',
          format('dry_run=%s', p_dry_run),
          jsonb_build_object('dry_run', p_dry_run));

  FOR r IN
    WITH grp AS (
      SELECT
        t.signal_id,
        COUNT(*)::int AS c,
        COUNT(*) FILTER (WHERE t.exit_date IS NULL)::int AS oc,
        array_agg(t.id ORDER BY t.created_at ASC, t.id ASC) AS ids,
        (
          BOOL_OR(t.exit_date IS NOT NULL)
          OR COUNT(DISTINCT t.entry_price) > 1
          OR COUNT(DISTINCT t.quantity) > 1
          OR COUNT(DISTINCT t.quantity_unit) > 1
          OR COUNT(DISTINCT t.entry_date) > 1
        ) AS manual
      FROM public.trade_records t
      WHERE t.signal_id IS NOT NULL
      GROUP BY t.signal_id
      HAVING COUNT(*) > 1
    )
    SELECT g.signal_id, g.c AS dup_count, g.oc AS open_count, g.ids, g.manual,
           s.expert_id, s.instrument
    FROM grp g
    LEFT JOIN public.expert_signals s ON s.id = g.signal_id
  LOOP
    v_scanned := v_scanned + 1;

    IF r.manual THEN
      v_needs_review := v_needs_review + 1;
      v_manual_list := v_manual_list || jsonb_build_object(
        'signal_id', r.signal_id,
        'expert_id', r.expert_id,
        'instrument', r.instrument,
        'dup_count', r.dup_count,
        'open_count', r.open_count,
        'trade_ids', to_jsonb(r.ids)
      );

      INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
      VALUES ('trade_dedupe_sweep', v_run_id, 'warning', 'skipped',
              'manual edit detected — human review required',
              r.signal_id, r.expert_id,
              jsonb_build_object('dup_count', r.dup_count, 'open_count', r.open_count,
                                 'trade_ids', to_jsonb(r.ids), 'instrument', r.instrument));
      CONTINUE;
    END IF;

    -- 乾淨個案：保留 ids[1]（最舊），刪除其餘
    v_keep := r.ids[1];
    v_remove := r.ids[2:array_length(r.ids, 1)];

    IF p_dry_run THEN
      INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
      VALUES ('trade_dedupe_sweep', v_run_id, 'info', 'fixed',
              format('DRY RUN would remove %s rows', array_length(v_remove, 1)),
              r.signal_id, r.expert_id,
              jsonb_build_object('kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
                                 'instrument', r.instrument, 'dry_run', true));
    ELSE
      DELETE FROM public.trade_records WHERE id = ANY(v_remove);

      INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
      VALUES (
        NULL, 'signal_dupe_trade_auto_fix', 'signal', r.signal_id,
        jsonb_build_object(
          'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
          'removed_count', array_length(v_remove, 1),
          'expert_id', r.expert_id, 'instrument', r.instrument,
          'run_id', v_run_id, 'source', 'trade_dedupe_sweep'
        )
      );

      INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
      VALUES ('trade_dedupe_sweep', v_run_id, 'info', 'fixed',
              format('removed %s rows', array_length(v_remove, 1)),
              r.signal_id, r.expert_id,
              jsonb_build_object('kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
                                 'instrument', r.instrument));

      v_removed_total := v_removed_total + COALESCE(array_length(v_remove, 1), 0);
    END IF;

    v_auto_fixed := v_auto_fixed + 1;
  END LOOP;

  -- 手動編輯告警：有就開，沒就自動收單
  IF v_needs_review > 0 THEN
    INSERT INTO public.system_alerts (kind, level, title, message, metric_value, detail)
    VALUES (
      'trade_dedupe_manual_review_required', 'warning',
      format('有 %s 筆重複 trade_records 需要人工審核', v_needs_review),
      '請至 /company/signal-dupe-audit 審核有手動編輯痕跡的重複個案',
      v_needs_review,
      jsonb_build_object('run_id', v_run_id, 'items', v_manual_list)
    )
    RETURNING id INTO v_alert_id;
  ELSE
    UPDATE public.system_alerts
       SET resolved_at = now()
     WHERE kind = 'trade_dedupe_manual_review_required'
       AND resolved_at IS NULL;
  END IF;

  -- 自動修復量爆增：暗示 trigger 或應用層破功
  IF v_auto_fixed > 20 AND NOT p_dry_run THEN
    INSERT INTO public.system_alerts (kind, level, title, message, metric_value, threshold, detail)
    VALUES (
      'trade_dedupe_surge', 'critical',
      format('單輪自動修復 %s 筆，疑似 trigger/併發保護失效', v_auto_fixed),
      '請立即檢查 handle_signal_trade trigger 與訊號送出路徑',
      v_auto_fixed, 20,
      jsonb_build_object('run_id', v_run_id, 'removed_total', v_removed_total)
    );
  END IF;

  INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, payload)
  VALUES ('trade_dedupe_sweep', v_run_id,
          CASE WHEN v_needs_review > 0 THEN 'warning' ELSE 'info' END,
          'done',
          format('scanned=%s auto_fixed=%s needs_review=%s removed=%s',
                 v_scanned, v_auto_fixed, v_needs_review, v_removed_total),
          jsonb_build_object(
            'scanned', v_scanned,
            'auto_fixed', v_auto_fixed,
            'needs_review', v_needs_review,
            'removed_total', v_removed_total,
            'dry_run', p_dry_run,
            'alert_id', v_alert_id
          ));

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'scanned', v_scanned,
    'auto_fixed', v_auto_fixed,
    'needs_review', v_needs_review,
    'removed_total', v_removed_total,
    'alert_id', v_alert_id
  );
END
$function$
;

-- pre-cutover grants (byte-equal to the frozen production baseline)
GRANT EXECUTE ON FUNCTION public.admin_apply_fix_proposal(p_id uuid, p_confirm boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_trade_records_by_symbol(_expert_id uuid, _symbol_prefix text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_fix_proposals(p_category text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_holdings_consistency_audit() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_cron_jobs() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_fix_proposal(p_id uuid, p_note text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_expert_asset_class(_expert_id uuid, _new_asset_class text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_trade_dedupe_sweep(p_dry_run boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_job_set_done(_id bigint, _status text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_job_set_failed(_id bigint, _error text, _retry_at timestamp with time zone) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_legacy_bsr_to_fact(_from date, _to date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_queue_stats() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_backfill_jobs(_batch_size integer, _max_priority_score integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_backfill_jobs(_jobs jsonb) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(p_stock_id text, p_days integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_institutional_backfill_universe() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_expert_capital_status(_expert_id uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_attempts(_limit integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_runs(_limit integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_publish_batch_status() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_subscription_after(_user_id uuid, _published_at timestamp with time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tester(_user_id uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_backfill_job_queue() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_batch_attempts_touch() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_backfill_jobs(_stale_after interval) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_holdings_fix_proposals_updated_at() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trade_dedupe_sweep(p_dry_run boolean) TO anon, authenticated, service_role;
