-- R1-D rollback aid: replays the production-extracted FUNCTION/TRIGGER definitions
-- so that 099_rollback.sql restores legacy writer bodies byte-for-byte.
SET check_function_bodies = off;
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
CREATE OR REPLACE FUNCTION public.admin_signal_dupe_trades_fix(p_signal_id uuid, p_dry_run boolean DEFAULT true, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_keep uuid;
  v_remove uuid[];
  v_manual boolean;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT has_role(v_actor, 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_keep
  FROM public.trade_records
  WHERE signal_id = p_signal_id
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_keep IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_rows', 'kept_id', null, 'removed_ids', '[]'::jsonb, 'executed', false);
  END IF;

  SELECT array_agg(id ORDER BY created_at ASC, id ASC) INTO v_remove
  FROM public.trade_records
  WHERE signal_id = p_signal_id AND id <> v_keep;

  IF v_remove IS NULL OR array_length(v_remove, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_dupes', 'kept_id', v_keep, 'removed_ids', '[]'::jsonb, 'executed', false);
  END IF;

  SELECT (
    BOOL_OR(exit_date IS NOT NULL)
    OR COUNT(DISTINCT entry_price) > 1
    OR COUNT(DISTINCT quantity) > 1
    OR COUNT(DISTINCT quantity_unit) > 1
    OR COUNT(DISTINCT entry_date) > 1
  )
  INTO v_manual
  FROM public.trade_records
  WHERE signal_id = p_signal_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
      'would_remove_count', array_length(v_remove, 1),
      'has_manual_edit', v_manual, 'executed', false
    );
  END IF;

  IF v_manual AND NOT p_force THEN
    RAISE EXCEPTION 'manual_edit_detected_require_force' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.trade_records WHERE id = ANY(v_remove);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor, 'signal_dupe_trade_fix', 'signal', p_signal_id,
    jsonb_build_object(
      'kept_id', v_keep,
      'removed_ids', to_jsonb(v_remove),
      'removed_count', array_length(v_remove, 1),
      'has_manual_edit', v_manual,
      'forced', p_force
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
    'removed_count', array_length(v_remove, 1),
    'has_manual_edit', v_manual, 'executed', true
  );
END; $function$
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
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_via text;
  v_target uuid;
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_expert uuid;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN v_actor := NULL;
  END;

  BEGIN
    v_via := auth.role();
  EXCEPTION WHEN OTHERS THEN v_via := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_target := (v_before->>'id')::uuid;
    v_expert := NULLIF(v_before->>'expert_id','')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
    v_target := (v_after->>'id')::uuid;
    v_expert := NULLIF(v_after->>'expert_id','')::uuid;
  ELSE  -- UPDATE
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_target := (v_after->>'id')::uuid;
    v_expert := NULLIF(v_after->>'expert_id','')::uuid;
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO v_changed
    FROM (
      SELECT key AS k
      FROM jsonb_each(v_after) a
      WHERE key NOT IN ('updated_at')
        AND (v_before->key) IS DISTINCT FROM a.value
    ) diff;
    -- No effective change => skip
    IF v_changed IS NULL OR array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor,
    TG_TABLE_NAME || '.' || TG_OP,
    TG_TABLE_NAME,
    v_target,
    jsonb_strip_nulls(jsonb_build_object(
      'op', TG_OP,
      'table', TG_TABLE_NAME,
      'via', v_via,
      'expert_id', v_expert,
      'before', v_before,
      'after', v_after,
      'changed', to_jsonb(v_changed)
    ))
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit_row_change failed for % %: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  total_trades integer := 0;
  winning_trades integer := 0;
  avg_pnl_pct numeric := 0;
  avg_hold numeric := 0;
  rec record;
  peak_amt numeric := 0;
  running_amt numeric := 0;
  worst_dd_amt numeric := 0;
  one_year_ago timestamp with time zone := NOW() - INTERVAL '1 year';
  return_1y numeric := 0;
  v_starting_capital numeric := 0;
  v_realized_amount numeric := 0;
  v_unrealized_amount numeric := 0;
  v_open_market_value numeric := 0;
  v_open_cost_value numeric := 0;
  v_current_asset numeric := 0;
  v_total_return_pct numeric := 0;
  v_max_drawdown_pct numeric := 0;
  v_profit_sum_amt numeric := 0;
  v_loss_sum_amt numeric := 0;
  v_profit_factor numeric := 0;
  v_avg_pnl_amount numeric := 0;
BEGIN
  -- starting capital
  SELECT COALESCE(starting_capital, 0) INTO v_starting_capital
  FROM public.experts WHERE id = _expert_id;

  -- closed-trade aggregates: count, win, avg pnl%, realized $, profit/loss $
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pnl_percent > 0),
    COALESCE(AVG(pnl_percent), 0),
    COALESCE(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ), 0),
    COALESCE(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ) FILTER (WHERE COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0)) > 0), 0),
    COALESCE(ABS(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ) FILTER (WHERE COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0)) < 0)), 0)
  INTO total_trades, winning_trades, avg_pnl_pct, v_realized_amount, v_profit_sum_amt, v_loss_sum_amt
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped');

  -- max drawdown: running pnl_amount cumulative (closed trades, ordered)
  FOR rec IN
    SELECT (COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))) AS pnl_amt
    FROM public.trade_records
    WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    ORDER BY exit_date ASC NULLS LAST, created_at ASC
  LOOP
    running_amt := running_amt + rec.pnl_amt;
    IF running_amt > peak_amt THEN peak_amt := running_amt; END IF;
    IF (peak_amt - running_amt) > worst_dd_amt THEN worst_dd_amt := peak_amt - running_amt; END IF;
  END LOOP;

  -- 1-year return: sum of pnl_amount in $ / starting_capital × 100
  SELECT COALESCE(SUM(
    COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
  ), 0)
  INTO return_1y
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    AND exit_date >= one_year_ago;

  -- avg hold days: include open trades (treat NOW() as exit)
  SELECT COALESCE(AVG(
    EXTRACT(EPOCH FROM (COALESCE(exit_date, NOW()) - entry_date)) / 86400
  ), 0)
  INTO avg_hold
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('open', 'closed', 'stopped');

  -- unrealized: open trades market value vs cost
  SELECT
    COALESCE(SUM(tr.quantity * COALESCE(cp.price, tr.current_price, tr.entry_price, 0)), 0),
    COALESCE(SUM(tr.quantity * COALESCE(tr.entry_price, 0)), 0)
  INTO v_open_market_value, v_open_cost_value
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id AND tr.status = 'open';

  v_unrealized_amount := v_open_market_value - v_open_cost_value;

  IF v_starting_capital > 0 THEN
    v_current_asset := v_starting_capital + v_realized_amount + v_unrealized_amount;
    v_total_return_pct := ROUND(((v_realized_amount + v_unrealized_amount) / v_starting_capital) * 100, 2);
    v_max_drawdown_pct := ROUND((worst_dd_amt / v_starting_capital) * 100, 2);
  ELSE
    v_current_asset := v_open_market_value;
    v_total_return_pct := 0;
    v_max_drawdown_pct := 0;
  END IF;

  -- profit factor in $
  IF v_loss_sum_amt > 0 THEN
    v_profit_factor := ROUND(v_profit_sum_amt / v_loss_sum_amt, 2);
  ELSIF v_profit_sum_amt > 0 THEN
    v_profit_factor := 999.99;
  ELSE
    v_profit_factor := 0;
  END IF;

  IF total_trades > 0 THEN
    v_avg_pnl_amount := ROUND(v_realized_amount / total_trades, 0);
  END IF;

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN ROUND((winning_trades::numeric / total_trades) * 100, 2) ELSE 0 END,
    'avg_pnl_pct', ROUND(avg_pnl_pct, 2),
    'avg_pnl_amount', v_avg_pnl_amount,
    'max_drawdown', v_max_drawdown_pct,
    'profit_factor', v_profit_factor,
    'avg_hold_days', ROUND(avg_hold, 1),
    'return_1y', CASE WHEN v_starting_capital > 0 THEN ROUND((return_1y / v_starting_capital) * 100, 2) ELSE 0 END,
    'current_asset', ROUND(v_current_asset, 0),
    'starting_capital', ROUND(v_starting_capital, 0),
    'realized_pnl_amount', ROUND(v_realized_amount, 0),
    'unrealized_pnl_amount', ROUND(v_unrealized_amount, 0),
    'total_return_pct', v_total_return_pct
  );

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_expert_asset_class_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.asset_class IS DISTINCT FROM OLD.asset_class THEN
    -- 管理員專用旁路：admin_reset_expert_asset_class 會先 SET LOCAL 這個變數
    IF coalesce(current_setting('app.bypass_asset_class_lock', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更資產類別（asset_class lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_expert_currency_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    IF coalesce(current_setting('app.bypass_asset_class_lock', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更幣別（currency lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_payment_provider_default_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_default = true AND NEW.is_active = false THEN
    RAISE EXCEPTION '無法將未啟用的金流通道設為預設 (provider_type=%, display_name=%)',
      NEW.provider_type, NEW.display_name
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.is_active = false AND NEW.is_default = true THEN
    NEW.is_default := false;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_plan_review_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean;
  is_owner boolean;
BEGIN
  is_admin := has_role(auth.uid(), 'company_admin');

  -- Admins can change anything (including review_status / review_note / reviewed_by / reviewed_at)
  IF is_admin THEN
    -- Auto-fill reviewer metadata when status changes
    IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Check ownership
  SELECT EXISTS (
    SELECT 1 FROM public.experts
    WHERE id = NEW.expert_id AND user_id = auth.uid()
  ) INTO is_owner;

  IF is_owner THEN
    -- Block analyst from changing review fields directly
    NEW.review_status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shares numeric;
  v_required numeric;
  v_available numeric;
  v_self_cost numeric := 0;
  v_status jsonb;
  v_currency text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;

  -- 只有會真正建帳（pending / published）的列需要檢核
  IF NEW.status NOT IN ('pending','published') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(currency, 'TWD'), COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_currency, v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NEW.quantity_unit IS NOT NULL AND NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, array_to_string(v_allowed, '/')
      USING ERRCODE = 'check_violation';
  END IF;

  -- 關鍵修正：pending 插入時 handle_signal_trade 就已建立 trade_records（資金已扣），
  -- 之後 pending -> published 只是狀態轉換，不可再扣一次，否則會 CAPITAL_EXCEEDED 卡住發布。
  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending','published') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_combo, false) THEN
    IF COALESCE(NEW.max_loss_per_unit, 0) <= 0 THEN
      RAISE EXCEPTION 'COMBO_MAX_LOSS_REQUIRED: 組合單必須提供每組最大損失（max_loss_per_unit）才能發布。'
        USING ERRCODE = 'check_violation';
    END IF;
    v_required := NEW.max_loss_per_unit * GREATEST(COALESCE(NEW.quantity, 1), 1);
  ELSE
    v_shares := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'tw_stock' AND COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'us_option' THEN COALESCE(NEW.quantity, 1) * 100
      ELSE COALESCE(NEW.quantity, 1)
    END;
    v_required := COALESCE(NEW.price_hint, 0) * v_shares;
  END IF;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  -- 防禦：若本筆 signal 已有自己的 trade_record（重試 / 補寫情境），把自身成本加回避免雙重計算
  SELECT COALESCE(SUM(COALESCE(quantity,0) * COALESCE(entry_price,0)), 0)
    INTO v_self_cost
  FROM public.trade_records
  WHERE signal_id = NEW.id AND status = 'open';

  v_available := v_available + COALESCE(v_self_cost, 0);

  IF v_required > v_available THEN
    RAISE EXCEPTION
      'CAPITAL_EXCEEDED: 此筆需 % %，可用現金僅 % %。請至「分析師設定」調整初始資金，或減少數量。',
      v_required, COALESCE(v_currency, 'TWD'), v_available, COALESCE(v_currency, 'TWD')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_signal_recall_same_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pub_day date;
  today_tw date;
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' AND OLD.published_at IS NOT NULL THEN
      pub_day := (OLD.published_at AT TIME ZONE 'Asia/Taipei')::date;
      today_tw := (now() AT TIME ZONE 'Asia/Taipei')::date;
      IF pub_day <> today_tw THEN
        RAISE EXCEPTION 'RECALL_EXPIRED: 已過發布當日（台灣時間），不可刪除已發布訊號'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_snapshot_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      v_sealed_at timestamptz;
    BEGIN
      SELECT sealed_at INTO v_sealed_at
        FROM public.tw_bsr_daily_snapshot_status
       WHERE trade_date = OLD.trade_date;

      IF v_sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'tw_bsr_daily row for trade_date % is sealed and cannot be modified', OLD.trade_date;
      END IF;

      RETURN NEW;
    END;
    $function$
;
CREATE OR REPLACE FUNCTION public.enforce_trade_record_market_currency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.market IS NOT NULL AND NEW.currency IS NOT NULL THEN
    IF NEW.market = 'TW' AND NEW.currency <> 'TWD' THEN
      RAISE EXCEPTION 'market_currency_mismatch: market=TW 只能搭配 currency=TWD（收到 currency=%）', NEW.currency
        USING ERRCODE = 'check_violation',
              HINT = 'MARKET_CURRENCY_LOCK: 若為美股請將 market 改為 US';
    ELSIF NEW.market = 'US' AND NEW.currency <> 'USD' THEN
      RAISE EXCEPTION 'market_currency_mismatch: market=US 只能搭配 currency=USD（收到 currency=%）', NEW.currency
        USING ERRCODE = 'check_violation',
              HINT = 'MARKET_CURRENCY_LOCK: 若為台股請將 market 改為 TW';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_unit_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_unit    text;
  v_existing_source  text;
  v_existing_row_id  text;
  v_existing_symbol  text;
  v_existing_qty     numeric;
  v_existing_created timestamptz;
  v_asset_class      text;
  v_allowed          text[];
  v_allowed_str      text;
  v_symbol           text;
BEGIN
  IF NEW.quantity_unit IS NULL OR btrim(NEW.quantity_unit) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.quantity_unit IS NOT NULL
     AND OLD.quantity_unit = NEW.quantity_unit
     AND OLD.instrument IS NOT DISTINCT FROM NEW.instrument
     AND OLD.expert_id IS NOT DISTINCT FROM NEW.expert_id THEN
    RETURN NEW;
  END IF;

  IF NEW.expert_id IS NULL OR NEW.instrument IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;
  v_allowed_str := array_to_string(v_allowed, '/');

  IF NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION
      '單位不相容：資產類別「%」不支援單位「%」，允許的單位為「%」。',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'ASSET_UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', asset_class=' || COALESCE(v_asset_class, 'tw_stock')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str;
  END IF;

  -- 組合單（多腿）以「組」為部位單位，與單腿「口」互不衝突，跳過同標的混用檢查
  IF NEW.quantity_unit = '組' OR COALESCE(NEW.is_combo, false) THEN
    RETURN NEW;
  END IF;

  v_symbol := split_part(btrim(NEW.instrument), ' ', 1);

  SELECT quantity_unit, 'expert_signals', id::text,
         split_part(btrim(instrument), ' ', 1), quantity, created_at
    INTO v_existing_unit, v_existing_source, v_existing_row_id,
         v_existing_symbol, v_existing_qty, v_existing_created
  FROM public.expert_signals
  WHERE expert_id = NEW.expert_id
    AND split_part(btrim(instrument), ' ', 1) = v_symbol
    AND quantity_unit IS NOT NULL
    AND quantity_unit <> NEW.quantity_unit
    AND quantity_unit <> '組'
    AND COALESCE(is_combo, false) = false
    AND status = 'pending'
    AND (TG_TABLE_NAME <> 'expert_signals' OR id <> NEW.id)
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_unit IS NULL THEN
    SELECT quantity_unit, 'trade_records', id::text,
           split_part(btrim(instrument), ' ', 1), quantity, created_at
      INTO v_existing_unit, v_existing_source, v_existing_row_id,
           v_existing_symbol, v_existing_qty, v_existing_created
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND split_part(btrim(instrument), ' ', 1) = v_symbol
      AND quantity_unit IS NOT NULL
      AND quantity_unit <> NEW.quantity_unit
      AND quantity_unit <> '組'
      AND COALESCE(is_combo, false) = false
      AND status = 'open'
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 目前已有一筆未平倉部位使用「%」單位（來源：% #%，數量 % %，建立於 %），無法在此代碼上同時混用「%」。允許單位：%。請先平倉，或到週記編輯頁使用「改單位…」把該部位單位校齊。',
      v_symbol,
      v_existing_unit,
      v_existing_source,
      v_existing_row_id,
      v_existing_qty,
      v_existing_unit,
      to_char(v_existing_created AT TIME ZONE 'Asia/Taipei', 'YYYY/MM/DD HH24:MI'),
      NEW.quantity_unit,
      v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', symbol=' || v_symbol
              || ', existing_source=' || v_existing_source
              || ', existing_row_id=' || v_existing_row_id
              || ', existing_unit=' || v_existing_unit
              || ', existing_quantity=' || COALESCE(v_existing_qty::text, '')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str
              || ', scope=open_positions_only';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_user_performance_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_price numeric;
begin
  select cp.price
  into v_price
  from public.current_prices cp
  where cp.symbol = new.symbol
  limit 1;

  if v_price is null then
    new.current_price := null;
    new.pnl := null;
    new.pnl_percent := null;
  else
    new.current_price := v_price;

    if new.entry_price is not null and new.entry_price > 0 then
      new.pnl := round((v_price - new.entry_price)::numeric, 3);
      new.pnl_percent := round((((v_price - new.entry_price) / new.entry_price) * 100)::numeric, 2);
    else
      new.pnl := null;
      new.pnl_percent := null;
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bsr_first_fetch_on_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock text;
  v_market text := UPPER(COALESCE(NEW.market, ''));
  v_d date;
  v_count int := 0;
BEGIN
  IF v_market NOT IN ('TW', 'TWSE', 'TPEX', '') THEN RETURN NEW; END IF;

  v_stock := (regexp_match(COALESCE(NEW.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1];
  IF v_stock IS NULL THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM public.tw_bsr_daily WHERE stock_id = v_stock) >= 20 THEN
    RETURN NEW;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < 60 LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES
        (v_stock, v_d, 1, 'pending', now(), 'trade_insert_hook_backfill', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 150;
  END LOOP;

  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_analyst_subscriber_profiles()
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.user_id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id IN (
    SELECT ms.user_id
    FROM public.member_subscriptions ms
    JOIN public.expert_plans ep ON ep.id = ms.plan_id
    JOIN public.experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  );
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
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_signal_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_record RECORD;
  sell_qty integer;
  remaining_qty integer;
  v_first text;
  v_market text;
  v_currency text;
  v_exists boolean;
  v_existing_trade_id uuid;
  v_unit text;
  v_asset_class text;
  v_trade_qty integer;
  v_inserted integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('published', 'pending') THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.status IN ('published', 'pending') THEN
    v_first := split_part(COALESCE(NEW.instrument, ''), ' ', 1);

    SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
      INTO v_asset_class
    FROM public.experts
    WHERE id = NEW.expert_id;

    v_asset_class := COALESCE(v_asset_class, 'tw_stock');

    v_market := CASE v_asset_class
      WHEN 'us_stock' THEN 'US'
      WHEN 'us_option' THEN 'US'
      WHEN 'us_future' THEN 'US'
      WHEN 'crypto' THEN 'CRYPTO'
      ELSE 'TW'
    END;

    v_currency := CASE v_asset_class
      WHEN 'us_stock' THEN 'USD'
      WHEN 'us_option' THEN 'USD'
      WHEN 'us_future' THEN 'USD'
      WHEN 'crypto' THEN 'USD'
      ELSE 'TWD'
    END;

    v_unit := COALESCE(
      NULLIF(btrim(NEW.quantity_unit), ''),
      CASE v_asset_class
        WHEN 'tw_stock' THEN '張'
        WHEN 'us_stock' THEN '股'
        WHEN 'crypto' THEN '顆'
        WHEN 'us_option' THEN '口'
        WHEN 'us_future' THEN '口'
        ELSE CASE WHEN v_currency = 'USD' THEN '股' ELSE '張' END
      END
    );

    v_trade_qty := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN v_asset_class = 'tw_stock' AND v_unit = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      ELSE COALESCE(NEW.quantity, 1)
    END;

    IF NEW.action IN ('buy', 'add', 'sell', 'trim', 'exit') THEN
      INSERT INTO public.signal_trade_applications (signal_id, expert_id, action, applied_quantity, tg_op)
      VALUES (NEW.id, NEW.expert_id, NEW.action::text, v_trade_qty, TG_OP)
      ON CONFLICT (signal_id) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      IF v_inserted = 0 THEN
        INSERT INTO public.function_run_logs
          (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
        VALUES (
          'handle_signal_trade',
          gen_random_uuid()::text,
          'info',
          'skipped_already_applied',
          format('signal %s 先前已套用過（%s），本次 %s 安全跳過（防重複）',
                 NEW.id, NEW.action, TG_OP),
          NEW.id,
          NEW.expert_id,
          jsonb_build_object(
            'action', NEW.action,
            'instrument', NEW.instrument,
            'tg_op', TG_OP,
            'quantity', NEW.quantity,
            'quantity_unit', v_unit,
            'trade_quantity', v_trade_qty,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;

      SELECT id INTO v_existing_trade_id FROM public.trade_records WHERE signal_id = NEW.id LIMIT 1;
      v_exists := v_existing_trade_id IS NOT NULL;
      IF v_exists THEN
        INSERT INTO public.function_run_logs
          (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
        VALUES (
          'handle_signal_trade',
          gen_random_uuid()::text,
          'info',
          'skipped_existing_trade',
          format('signal %s 已對應 trade_record %s，%s 動作安全跳過（防重複）',
                 NEW.id, v_existing_trade_id, NEW.action),
          NEW.id,
          NEW.expert_id,
          jsonb_build_object(
            'action', NEW.action,
            'instrument', NEW.instrument,
            'tg_op', TG_OP,
            'existing_trade_id', v_existing_trade_id,
            'quantity', NEW.quantity,
            'quantity_unit', v_unit,
            'trade_quantity', v_trade_qty,
            'asset_class', v_asset_class,
            'market', v_market,
            'currency', v_currency,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, v_trade_qty, v_unit, v_market, v_currency);

    ELSIF NEW.action = 'add' THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.trade_records
        SET entry_price = CASE
              WHEN (existing_record.quantity + v_trade_qty) > 0
              THEN ROUND(
                (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
                 + v_trade_qty * COALESCE(NEW.price_hint, 0))
                / (existing_record.quantity + v_trade_qty)
              , 2)
              ELSE existing_record.entry_price
            END,
            quantity = existing_record.quantity + v_trade_qty,
            quantity_unit = COALESCE(existing_record.quantity_unit, v_unit),
            market = COALESCE(market, v_market),
            currency = COALESCE(currency, v_currency)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, v_trade_qty, v_unit, v_market, v_currency);
      END IF;

    ELSIF NEW.action IN ('sell', 'trim') THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        sell_qty := LEAST(v_trade_qty, existing_record.quantity);
        remaining_qty := existing_record.quantity - sell_qty;

        IF remaining_qty <= 0 THEN
          UPDATE public.trade_records
          SET exit_price = NEW.price_hint,
              exit_date = COALESCE(NEW.published_at, NOW()),
              pnl_percent = CASE
                WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
                THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
                ELSE NULL
              END,
              quantity_unit = COALESCE(quantity_unit, existing_record.quantity_unit, v_unit),
              status = 'closed'::trade_status
          WHERE id = existing_record.id;
        ELSE
          UPDATE public.trade_records
          SET quantity = remaining_qty,
              quantity_unit = COALESCE(quantity_unit, existing_record.quantity_unit, v_unit)
          WHERE id = existing_record.id;

          INSERT INTO public.trade_records (
            expert_id, signal_id, instrument,
            entry_price, entry_date,
            exit_price, exit_date,
            pnl_percent, quantity, quantity_unit, status, market, currency
          ) VALUES (
            NEW.expert_id, NEW.id, NEW.instrument,
            existing_record.entry_price, existing_record.entry_date,
            NEW.price_hint, COALESCE(NEW.published_at, NOW()),
            CASE
              WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
              THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
              ELSE NULL
            END,
            sell_qty,
            COALESCE(existing_record.quantity_unit, v_unit),
            'closed'::trade_status,
            COALESCE(existing_record.market, v_market),
            COALESCE(existing_record.currency, v_currency)
          );
        END IF;
      END IF;

    ELSIF NEW.action = 'exit' THEN
      UPDATE public.trade_records
      SET exit_price = NEW.price_hint,
          exit_date = COALESCE(NEW.published_at, NOW()),
          pnl_percent = CASE
            WHEN entry_price IS NOT NULL AND entry_price > 0
            THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
            ELSE NULL
          END,
          quantity_unit = COALESCE(quantity_unit, v_unit),
          status = 'closed'::trade_status
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
 RETURNS TABLE(plan_id uuid, expert_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ms.plan_id, ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  WHERE ms.user_id = _user_id
    AND ms.status = 'active'
    AND (ms.expires_at IS NULL OR ms.expires_at > now())
$function$
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
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_subscribed_to_plan(_user_id uuid, _plan_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.member_subscriptions
    WHERE user_id = _user_id
      AND plan_id = _plan_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
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
CREATE OR REPLACE FUNCTION public.protect_backtest_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Force these columns to retain their original values regardless of who updates
  -- Backtest KPIs must be system-calculated from trade_records, never manually edited
  NEW.backtest_1y_return := OLD.backtest_1y_return;
  NEW.backtest_max_drawdown := OLD.backtest_max_drawdown;
  NEW.backtest_annual_return := OLD.backtest_annual_return;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when invoked from edge functions with service role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- Block non-admin users from changing privileged fields
  IF NEW.is_tester IS DISTINCT FROM OLD.is_tester THEN
    RAISE EXCEPTION 'You cannot modify tester status';
  END IF;
  IF NEW.expert_slug IS DISTINCT FROM OLD.expert_slug THEN
    RAISE EXCEPTION 'You cannot modify expert slug';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role (edge functions) — auth.uid() is NULL when called with service role
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- For regular users, block changes to sensitive fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'You cannot modify subscription status';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'You cannot modify subscription expiry';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'You cannot modify subscription start date';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'You cannot modify subscription plan';
  END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'You cannot modify payment provider';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.realign_instrument_unit(p_expert_id uuid, p_symbol_prefix text, p_new_unit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_is_admin boolean;
  v_sig_count int := 0;
  v_tr_count int := 0;
  v_prefix text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF p_expert_id IS NULL OR p_symbol_prefix IS NULL OR p_new_unit IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;
  IF p_new_unit NOT IN ('張','股','顆','口') THEN
    RAISE EXCEPTION 'invalid_unit: %', p_new_unit;
  END IF;

  SELECT user_id, COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_owner, v_asset_class
  FROM public.experts WHERE id = p_expert_id;

  v_is_admin := public.has_role(v_uid, 'company_admin'::app_role);

  IF NOT v_is_admin AND (v_owner IS NULL OR v_owner <> v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 依 asset_class 允許的單位（與前端 asset.ts 對齊）
  v_allowed := CASE v_asset_class
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NOT (p_new_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      v_asset_class, p_new_unit, array_to_string(v_allowed, '/');
  END IF;

  v_prefix := trim(p_symbol_prefix) || '%';

  UPDATE public.expert_signals
  SET quantity_unit = p_new_unit
  WHERE expert_id = p_expert_id
    AND instrument ILIKE v_prefix
    AND quantity_unit IS DISTINCT FROM p_new_unit;
  GET DIAGNOSTICS v_sig_count = ROW_COUNT;

  UPDATE public.trade_records
  SET quantity_unit = p_new_unit
  WHERE expert_id = p_expert_id
    AND instrument ILIKE v_prefix
    AND quantity_unit IS DISTINCT FROM p_new_unit;
  GET DIAGNOSTICS v_tr_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'signals_updated', v_sig_count,
    'trades_updated', v_tr_count,
    'new_unit', p_new_unit,
    'asset_class', v_asset_class
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.recalc_user_summary_on_perf_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _remaining int;
  _total double precision;
  _avg double precision;
BEGIN
  SELECT count(*), coalesce(sum(pnl_percent), 0), coalesce(avg(pnl_percent), 0)
    INTO _remaining, _total, _avg
    FROM user_performances
   WHERE user_id = OLD.user_id;

  IF _remaining = 0 THEN
    UPDATE user_summaries
       SET total_pnl_percent = 0,
           avg_pnl_percent = 0,
           updated_at = now()
     WHERE user_id = OLD.user_id;
  ELSE
    UPDATE user_summaries
       SET total_pnl_percent = _total,
           avg_pnl_percent = _avg,
           updated_at = now()
     WHERE user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_signal_batch(_expert_id uuid, _batch_id uuid, _signals jsonb, _legs jsonb DEFAULT '[]'::jsonb, _is_editing boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _inserted integer := 0;
  _old_ids uuid[];
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = _caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _signals IS NULL OR jsonb_typeof(_signals) <> 'array' OR jsonb_array_length(_signals) = 0 THEN
    RAISE EXCEPTION 'empty_signals' USING ERRCODE = '22023';
  END IF;

  -- 所有 row 必須屬於同一位分析師與同一批次
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_signals) s
    WHERE (s->>'expert_id')::uuid IS DISTINCT FROM _expert_id
       OR (s->>'batch_id')::uuid IS DISTINCT FROM _batch_id
  ) THEN
    RAISE EXCEPTION 'batch_mismatch' USING ERRCODE = '22023';
  END IF;

  IF _is_editing THEN
    SELECT array_agg(id) INTO _old_ids
    FROM public.expert_signals
    WHERE batch_id = _batch_id AND expert_id = _expert_id;

    IF _old_ids IS NOT NULL AND array_length(_old_ids, 1) > 0 THEN
      DELETE FROM public.trade_records WHERE signal_id = ANY(_old_ids);
      DELETE FROM public.expert_signal_legs WHERE signal_id = ANY(_old_ids);
      DELETE FROM public.expert_signals WHERE id = ANY(_old_ids);
    END IF;
  END IF;

  WITH src AS (
    SELECT * FROM jsonb_populate_recordset(null::public.expert_signals, _signals)
  )
  INSERT INTO public.expert_signals (
    id, expert_id, plan_id, batch_id, instrument, action, price_hint,
    reason_summary, reason_detail, risk_notes, learning_points,
    status, published_at, created_at, quantity, quantity_unit,
    teaching_topic, overall_summary, executed_at,
    is_combo, combo_strategy, net_premium, max_loss_per_unit, max_profit_per_unit
  )
  SELECT
    COALESCE(src.id, gen_random_uuid()), _expert_id, src.plan_id, _batch_id, src.instrument,
    src.action, src.price_hint, src.reason_summary, src.reason_detail, src.risk_notes,
    src.learning_points, COALESCE(src.status, 'published'::signal_status),
    COALESCE(src.published_at, now()), COALESCE(src.created_at, now()),
    src.quantity, src.quantity_unit, src.teaching_topic, src.overall_summary,
    src.executed_at, COALESCE(src.is_combo, false), src.combo_strategy,
    src.net_premium, src.max_loss_per_unit, src.max_profit_per_unit
  FROM src;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF _legs IS NOT NULL AND jsonb_typeof(_legs) = 'array' AND jsonb_array_length(_legs) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(_legs) l
      WHERE NOT EXISTS (
        SELECT 1 FROM public.expert_signals es
        WHERE es.id = (l->>'signal_id')::uuid AND es.batch_id = _batch_id
      )
    ) THEN
      RAISE EXCEPTION 'leg_signal_mismatch' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.expert_signal_legs (
      signal_id, leg_index, occ_symbol, underlying, expiry, right_type,
      strike, side, ratio, leg_price
    )
    SELECT signal_id, leg_index, occ_symbol, underlying, expiry, right_type,
           strike, side, ratio, leg_price
    FROM jsonb_populate_recordset(null::public.expert_signal_legs, _legs);
  END IF;

  RETURN _inserted;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_expert_signal_market()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ac text;
  v_cur text;
BEGIN
  IF NEW.market IS NOT NULL AND NEW.market <> '' THEN
    RETURN NEW;
  END IF;

  SELECT asset_class, currency INTO v_ac, v_cur
    FROM public.experts WHERE id = NEW.expert_id;

  NEW.market := CASE
    WHEN v_ac = 'tw_stock' THEN 'TW'
    WHEN v_ac IN ('us_stock','us_option','us_future') THEN 'US'
    WHEN v_cur = 'TWD' THEN 'TW'
    WHEN v_cur = 'USD' THEN 'US'
    ELSE 'TW'
  END;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_plan_initial_review_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean;
BEGIN
  is_admin := has_role(auth.uid(), 'company_admin');
  
  IF NOT is_admin THEN
    -- Force pending for non-admin inserts
    NEW.review_status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.signal_in_subscription_window(_role expert_role, _started_at timestamp with time zone, _expires_at timestamp with time zone, _published_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _role = 'mentor' THEN
      (_published_at + INTERVAL '7 days') >= _started_at
      AND (_expires_at IS NULL OR _published_at <= _expires_at)
    ELSE
      _published_at >= _started_at
      AND (_expires_at IS NULL OR _published_at <= _expires_at)
  END
$function$
;
CREATE OR REPLACE FUNCTION public.sync_expert_currency_with_asset_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.asset_class = 'tw_stock' THEN
    NEW.currency := 'TWD';
  ELSIF NEW.asset_class IN ('us_stock','crypto','us_option','us_future') THEN
    NEW.currency := 'USD';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_expert_slug_to_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_display_name text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.slug IS NULL THEN
    RETURN NEW;
  END IF;

  -- Try update first
  UPDATE public.profiles
     SET expert_slug = NEW.slug
   WHERE user_id = NEW.user_id
     AND (expert_slug IS DISTINCT FROM NEW.slug);

  IF NOT FOUND THEN
    -- Insert new profile if missing
    SELECT COALESCE(u.raw_user_meta_data->>'display_name',
                    u.raw_user_meta_data->>'name',
                    split_part(u.email, '@', 1),
                    NEW.slug)
      INTO v_display_name
      FROM auth.users u
     WHERE u.id = NEW.user_id;

    INSERT INTO public.profiles (user_id, display_name, expert_slug)
    VALUES (NEW.user_id, COALESCE(v_display_name, NEW.slug), NEW.slug)
    ON CONFLICT (user_id) DO UPDATE
      SET expert_slug = EXCLUDED.expert_slug;
  END IF;

  RETURN NEW;
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
CREATE OR REPLACE FUNCTION public.trg_daily_snapshot_normalize_volume()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  n RECORD;
BEGIN
  IF NEW.volume IS NULL THEN
    NEW.volume_unit := COALESCE(NEW.volume_unit, 'unknown');
    NEW.volume_shares := NULL;
    RETURN NEW;
  END IF;

  IF NEW.volume_shares IS NULL OR NEW.volume_unit IS NULL THEN
    SELECT * INTO n FROM public.normalize_snapshot_volume_shares(NEW.market, NEW.volume, NEW.volume_unit);
    NEW.volume_unit := COALESCE(NEW.volume_unit, n.unit);
    NEW.volume_shares := COALESCE(NEW.volume_shares, n.shares);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_expert_ai_reindex()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT expert_id FROM changed_rows WHERE expert_id IS NOT NULL
  LOOP
    PERFORM net.http_post(
      url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/expert-ai-index',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo'
      ),
      body := jsonb_build_object('expert_id', rec.expert_id, 'trigger', TG_OP)
    );
  END LOOP;
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.tw_bsr_sync_queue_touch_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
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
CREATE OR REPLACE FUNCTION public.admin_signal_dupe_trades_fix(p_signal_id uuid, p_dry_run boolean DEFAULT true, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_keep uuid;
  v_remove uuid[];
  v_manual boolean;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT has_role(v_actor, 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_keep
  FROM public.trade_records
  WHERE signal_id = p_signal_id
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_keep IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_rows', 'kept_id', null, 'removed_ids', '[]'::jsonb, 'executed', false);
  END IF;

  SELECT array_agg(id ORDER BY created_at ASC, id ASC) INTO v_remove
  FROM public.trade_records
  WHERE signal_id = p_signal_id AND id <> v_keep;

  IF v_remove IS NULL OR array_length(v_remove, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_dupes', 'kept_id', v_keep, 'removed_ids', '[]'::jsonb, 'executed', false);
  END IF;

  SELECT (
    BOOL_OR(exit_date IS NOT NULL)
    OR COUNT(DISTINCT entry_price) > 1
    OR COUNT(DISTINCT quantity) > 1
    OR COUNT(DISTINCT quantity_unit) > 1
    OR COUNT(DISTINCT entry_date) > 1
  )
  INTO v_manual
  FROM public.trade_records
  WHERE signal_id = p_signal_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
      'would_remove_count', array_length(v_remove, 1),
      'has_manual_edit', v_manual, 'executed', false
    );
  END IF;

  IF v_manual AND NOT p_force THEN
    RAISE EXCEPTION 'manual_edit_detected_require_force' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.trade_records WHERE id = ANY(v_remove);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor, 'signal_dupe_trade_fix', 'signal', p_signal_id,
    jsonb_build_object(
      'kept_id', v_keep,
      'removed_ids', to_jsonb(v_remove),
      'removed_count', array_length(v_remove, 1),
      'has_manual_edit', v_manual,
      'forced', p_force
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
    'removed_count', array_length(v_remove, 1),
    'has_manual_edit', v_manual, 'executed', true
  );
END; $function$
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
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_via text;
  v_target uuid;
  v_before jsonb;
  v_after jsonb;
  v_changed text[];
  v_expert uuid;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN v_actor := NULL;
  END;

  BEGIN
    v_via := auth.role();
  EXCEPTION WHEN OTHERS THEN v_via := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_target := (v_before->>'id')::uuid;
    v_expert := NULLIF(v_before->>'expert_id','')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
    v_target := (v_after->>'id')::uuid;
    v_expert := NULLIF(v_after->>'expert_id','')::uuid;
  ELSE  -- UPDATE
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_target := (v_after->>'id')::uuid;
    v_expert := NULLIF(v_after->>'expert_id','')::uuid;
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO v_changed
    FROM (
      SELECT key AS k
      FROM jsonb_each(v_after) a
      WHERE key NOT IN ('updated_at')
        AND (v_before->key) IS DISTINCT FROM a.value
    ) diff;
    -- No effective change => skip
    IF v_changed IS NULL OR array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor,
    TG_TABLE_NAME || '.' || TG_OP,
    TG_TABLE_NAME,
    v_target,
    jsonb_strip_nulls(jsonb_build_object(
      'op', TG_OP,
      'table', TG_TABLE_NAME,
      'via', v_via,
      'expert_id', v_expert,
      'before', v_before,
      'after', v_after,
      'changed', to_jsonb(v_changed)
    ))
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit_row_change failed for % %: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  total_trades integer := 0;
  winning_trades integer := 0;
  avg_pnl_pct numeric := 0;
  avg_hold numeric := 0;
  rec record;
  peak_amt numeric := 0;
  running_amt numeric := 0;
  worst_dd_amt numeric := 0;
  one_year_ago timestamp with time zone := NOW() - INTERVAL '1 year';
  return_1y numeric := 0;
  v_starting_capital numeric := 0;
  v_realized_amount numeric := 0;
  v_unrealized_amount numeric := 0;
  v_open_market_value numeric := 0;
  v_open_cost_value numeric := 0;
  v_current_asset numeric := 0;
  v_total_return_pct numeric := 0;
  v_max_drawdown_pct numeric := 0;
  v_profit_sum_amt numeric := 0;
  v_loss_sum_amt numeric := 0;
  v_profit_factor numeric := 0;
  v_avg_pnl_amount numeric := 0;
BEGIN
  -- starting capital
  SELECT COALESCE(starting_capital, 0) INTO v_starting_capital
  FROM public.experts WHERE id = _expert_id;

  -- closed-trade aggregates: count, win, avg pnl%, realized $, profit/loss $
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pnl_percent > 0),
    COALESCE(AVG(pnl_percent), 0),
    COALESCE(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ), 0),
    COALESCE(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ) FILTER (WHERE COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0)) > 0), 0),
    COALESCE(ABS(SUM(
      COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
    ) FILTER (WHERE COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0)) < 0)), 0)
  INTO total_trades, winning_trades, avg_pnl_pct, v_realized_amount, v_profit_sum_amt, v_loss_sum_amt
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped');

  -- max drawdown: running pnl_amount cumulative (closed trades, ordered)
  FOR rec IN
    SELECT (COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))) AS pnl_amt
    FROM public.trade_records
    WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    ORDER BY exit_date ASC NULLS LAST, created_at ASC
  LOOP
    running_amt := running_amt + rec.pnl_amt;
    IF running_amt > peak_amt THEN peak_amt := running_amt; END IF;
    IF (peak_amt - running_amt) > worst_dd_amt THEN worst_dd_amt := peak_amt - running_amt; END IF;
  END LOOP;

  -- 1-year return: sum of pnl_amount in $ / starting_capital × 100
  SELECT COALESCE(SUM(
    COALESCE(quantity, 0) * (COALESCE(exit_price, entry_price, 0) - COALESCE(entry_price, 0))
  ), 0)
  INTO return_1y
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('closed', 'stopped')
    AND exit_date >= one_year_ago;

  -- avg hold days: include open trades (treat NOW() as exit)
  SELECT COALESCE(AVG(
    EXTRACT(EPOCH FROM (COALESCE(exit_date, NOW()) - entry_date)) / 86400
  ), 0)
  INTO avg_hold
  FROM public.trade_records
  WHERE expert_id = _expert_id AND status IN ('open', 'closed', 'stopped');

  -- unrealized: open trades market value vs cost
  SELECT
    COALESCE(SUM(tr.quantity * COALESCE(cp.price, tr.current_price, tr.entry_price, 0)), 0),
    COALESCE(SUM(tr.quantity * COALESCE(tr.entry_price, 0)), 0)
  INTO v_open_market_value, v_open_cost_value
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id AND tr.status = 'open';

  v_unrealized_amount := v_open_market_value - v_open_cost_value;

  IF v_starting_capital > 0 THEN
    v_current_asset := v_starting_capital + v_realized_amount + v_unrealized_amount;
    v_total_return_pct := ROUND(((v_realized_amount + v_unrealized_amount) / v_starting_capital) * 100, 2);
    v_max_drawdown_pct := ROUND((worst_dd_amt / v_starting_capital) * 100, 2);
  ELSE
    v_current_asset := v_open_market_value;
    v_total_return_pct := 0;
    v_max_drawdown_pct := 0;
  END IF;

  -- profit factor in $
  IF v_loss_sum_amt > 0 THEN
    v_profit_factor := ROUND(v_profit_sum_amt / v_loss_sum_amt, 2);
  ELSIF v_profit_sum_amt > 0 THEN
    v_profit_factor := 999.99;
  ELSE
    v_profit_factor := 0;
  END IF;

  IF total_trades > 0 THEN
    v_avg_pnl_amount := ROUND(v_realized_amount / total_trades, 0);
  END IF;

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN ROUND((winning_trades::numeric / total_trades) * 100, 2) ELSE 0 END,
    'avg_pnl_pct', ROUND(avg_pnl_pct, 2),
    'avg_pnl_amount', v_avg_pnl_amount,
    'max_drawdown', v_max_drawdown_pct,
    'profit_factor', v_profit_factor,
    'avg_hold_days', ROUND(avg_hold, 1),
    'return_1y', CASE WHEN v_starting_capital > 0 THEN ROUND((return_1y / v_starting_capital) * 100, 2) ELSE 0 END,
    'current_asset', ROUND(v_current_asset, 0),
    'starting_capital', ROUND(v_starting_capital, 0),
    'realized_pnl_amount', ROUND(v_realized_amount, 0),
    'unrealized_pnl_amount', ROUND(v_unrealized_amount, 0),
    'total_return_pct', v_total_return_pct
  );

  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_expert_asset_class_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.asset_class IS DISTINCT FROM OLD.asset_class THEN
    -- 管理員專用旁路：admin_reset_expert_asset_class 會先 SET LOCAL 這個變數
    IF coalesce(current_setting('app.bypass_asset_class_lock', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更資產類別（asset_class lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_expert_currency_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    IF coalesce(current_setting('app.bypass_asset_class_lock', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更幣別（currency lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_payment_provider_default_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_default = true AND NEW.is_active = false THEN
    RAISE EXCEPTION '無法將未啟用的金流通道設為預設 (provider_type=%, display_name=%)',
      NEW.provider_type, NEW.display_name
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.is_active = false AND NEW.is_default = true THEN
    NEW.is_default := false;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_plan_review_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean;
  is_owner boolean;
BEGIN
  is_admin := has_role(auth.uid(), 'company_admin');

  -- Admins can change anything (including review_status / review_note / reviewed_by / reviewed_at)
  IF is_admin THEN
    -- Auto-fill reviewer metadata when status changes
    IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Check ownership
  SELECT EXISTS (
    SELECT 1 FROM public.experts
    WHERE id = NEW.expert_id AND user_id = auth.uid()
  ) INTO is_owner;

  IF is_owner THEN
    -- Block analyst from changing review fields directly
    NEW.review_status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shares numeric;
  v_required numeric;
  v_available numeric;
  v_self_cost numeric := 0;
  v_status jsonb;
  v_currency text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;

  -- 只有會真正建帳（pending / published）的列需要檢核
  IF NEW.status NOT IN ('pending','published') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(currency, 'TWD'), COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_currency, v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NEW.quantity_unit IS NOT NULL AND NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, array_to_string(v_allowed, '/')
      USING ERRCODE = 'check_violation';
  END IF;

  -- 關鍵修正：pending 插入時 handle_signal_trade 就已建立 trade_records（資金已扣），
  -- 之後 pending -> published 只是狀態轉換，不可再扣一次，否則會 CAPITAL_EXCEEDED 卡住發布。
  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending','published') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_combo, false) THEN
    IF COALESCE(NEW.max_loss_per_unit, 0) <= 0 THEN
      RAISE EXCEPTION 'COMBO_MAX_LOSS_REQUIRED: 組合單必須提供每組最大損失（max_loss_per_unit）才能發布。'
        USING ERRCODE = 'check_violation';
    END IF;
    v_required := NEW.max_loss_per_unit * GREATEST(COALESCE(NEW.quantity, 1), 1);
  ELSE
    v_shares := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'tw_stock' AND COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'us_option' THEN COALESCE(NEW.quantity, 1) * 100
      ELSE COALESCE(NEW.quantity, 1)
    END;
    v_required := COALESCE(NEW.price_hint, 0) * v_shares;
  END IF;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  -- 防禦：若本筆 signal 已有自己的 trade_record（重試 / 補寫情境），把自身成本加回避免雙重計算
  SELECT COALESCE(SUM(COALESCE(quantity,0) * COALESCE(entry_price,0)), 0)
    INTO v_self_cost
  FROM public.trade_records
  WHERE signal_id = NEW.id AND status = 'open';

  v_available := v_available + COALESCE(v_self_cost, 0);

  IF v_required > v_available THEN
    RAISE EXCEPTION
      'CAPITAL_EXCEEDED: 此筆需 % %，可用現金僅 % %。請至「分析師設定」調整初始資金，或減少數量。',
      v_required, COALESCE(v_currency, 'TWD'), v_available, COALESCE(v_currency, 'TWD')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_signal_recall_same_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pub_day date;
  today_tw date;
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' AND OLD.published_at IS NOT NULL THEN
      pub_day := (OLD.published_at AT TIME ZONE 'Asia/Taipei')::date;
      today_tw := (now() AT TIME ZONE 'Asia/Taipei')::date;
      IF pub_day <> today_tw THEN
        RAISE EXCEPTION 'RECALL_EXPIRED: 已過發布當日（台灣時間），不可刪除已發布訊號'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_snapshot_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      v_sealed_at timestamptz;
    BEGIN
      SELECT sealed_at INTO v_sealed_at
        FROM public.tw_bsr_daily_snapshot_status
       WHERE trade_date = OLD.trade_date;

      IF v_sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'tw_bsr_daily row for trade_date % is sealed and cannot be modified', OLD.trade_date;
      END IF;

      RETURN NEW;
    END;
    $function$
;
CREATE OR REPLACE FUNCTION public.enforce_trade_record_market_currency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.market IS NOT NULL AND NEW.currency IS NOT NULL THEN
    IF NEW.market = 'TW' AND NEW.currency <> 'TWD' THEN
      RAISE EXCEPTION 'market_currency_mismatch: market=TW 只能搭配 currency=TWD（收到 currency=%）', NEW.currency
        USING ERRCODE = 'check_violation',
              HINT = 'MARKET_CURRENCY_LOCK: 若為美股請將 market 改為 US';
    ELSIF NEW.market = 'US' AND NEW.currency <> 'USD' THEN
      RAISE EXCEPTION 'market_currency_mismatch: market=US 只能搭配 currency=USD（收到 currency=%）', NEW.currency
        USING ERRCODE = 'check_violation',
              HINT = 'MARKET_CURRENCY_LOCK: 若為台股請將 market 改為 TW';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_unit_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_unit    text;
  v_existing_source  text;
  v_existing_row_id  text;
  v_existing_symbol  text;
  v_existing_qty     numeric;
  v_existing_created timestamptz;
  v_asset_class      text;
  v_allowed          text[];
  v_allowed_str      text;
  v_symbol           text;
BEGIN
  IF NEW.quantity_unit IS NULL OR btrim(NEW.quantity_unit) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.quantity_unit IS NOT NULL
     AND OLD.quantity_unit = NEW.quantity_unit
     AND OLD.instrument IS NOT DISTINCT FROM NEW.instrument
     AND OLD.expert_id IS NOT DISTINCT FROM NEW.expert_id THEN
    RETURN NEW;
  END IF;

  IF NEW.expert_id IS NULL OR NEW.instrument IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;
  v_allowed_str := array_to_string(v_allowed, '/');

  IF NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION
      '單位不相容：資產類別「%」不支援單位「%」，允許的單位為「%」。',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'ASSET_UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', asset_class=' || COALESCE(v_asset_class, 'tw_stock')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str;
  END IF;

  -- 組合單（多腿）以「組」為部位單位，與單腿「口」互不衝突，跳過同標的混用檢查
  IF NEW.quantity_unit = '組' OR COALESCE(NEW.is_combo, false) THEN
    RETURN NEW;
  END IF;

  v_symbol := split_part(btrim(NEW.instrument), ' ', 1);

  SELECT quantity_unit, 'expert_signals', id::text,
         split_part(btrim(instrument), ' ', 1), quantity, created_at
    INTO v_existing_unit, v_existing_source, v_existing_row_id,
         v_existing_symbol, v_existing_qty, v_existing_created
  FROM public.expert_signals
  WHERE expert_id = NEW.expert_id
    AND split_part(btrim(instrument), ' ', 1) = v_symbol
    AND quantity_unit IS NOT NULL
    AND quantity_unit <> NEW.quantity_unit
    AND quantity_unit <> '組'
    AND COALESCE(is_combo, false) = false
    AND status = 'pending'
    AND (TG_TABLE_NAME <> 'expert_signals' OR id <> NEW.id)
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_unit IS NULL THEN
    SELECT quantity_unit, 'trade_records', id::text,
           split_part(btrim(instrument), ' ', 1), quantity, created_at
      INTO v_existing_unit, v_existing_source, v_existing_row_id,
           v_existing_symbol, v_existing_qty, v_existing_created
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND split_part(btrim(instrument), ' ', 1) = v_symbol
      AND quantity_unit IS NOT NULL
      AND quantity_unit <> NEW.quantity_unit
      AND quantity_unit <> '組'
      AND COALESCE(is_combo, false) = false
      AND status = 'open'
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 目前已有一筆未平倉部位使用「%」單位（來源：% #%，數量 % %，建立於 %），無法在此代碼上同時混用「%」。允許單位：%。請先平倉，或到週記編輯頁使用「改單位…」把該部位單位校齊。',
      v_symbol,
      v_existing_unit,
      v_existing_source,
      v_existing_row_id,
      v_existing_qty,
      v_existing_unit,
      to_char(v_existing_created AT TIME ZONE 'Asia/Taipei', 'YYYY/MM/DD HH24:MI'),
      NEW.quantity_unit,
      v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', symbol=' || v_symbol
              || ', existing_source=' || v_existing_source
              || ', existing_row_id=' || v_existing_row_id
              || ', existing_unit=' || v_existing_unit
              || ', existing_quantity=' || COALESCE(v_existing_qty::text, '')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str
              || ', scope=open_positions_only';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_user_performance_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_price numeric;
begin
  select cp.price
  into v_price
  from public.current_prices cp
  where cp.symbol = new.symbol
  limit 1;

  if v_price is null then
    new.current_price := null;
    new.pnl := null;
    new.pnl_percent := null;
  else
    new.current_price := v_price;

    if new.entry_price is not null and new.entry_price > 0 then
      new.pnl := round((v_price - new.entry_price)::numeric, 3);
      new.pnl_percent := round((((v_price - new.entry_price) / new.entry_price) * 100)::numeric, 2);
    else
      new.pnl := null;
      new.pnl_percent := null;
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_bsr_first_fetch_on_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock text;
  v_market text := UPPER(COALESCE(NEW.market, ''));
  v_d date;
  v_count int := 0;
BEGIN
  IF v_market NOT IN ('TW', 'TWSE', 'TPEX', '') THEN RETURN NEW; END IF;

  v_stock := (regexp_match(COALESCE(NEW.instrument, ''), '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1];
  IF v_stock IS NULL THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM public.tw_bsr_daily WHERE stock_id = v_stock) >= 20 THEN
    RETURN NEW;
  END IF;

  v_d := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE v_count < 60 LOOP
    IF EXTRACT(ISODOW FROM v_d) < 6 THEN
      INSERT INTO public.tw_bsr_sync_queue
        (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
      VALUES
        (v_stock, v_d, 1, 'pending', now(), 'trade_insert_hook_backfill', gen_random_uuid(), false)
      ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
    v_d := v_d - 1;
    EXIT WHEN v_d < (now() AT TIME ZONE 'Asia/Taipei')::date - 150;
  END LOOP;

  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_analyst_subscriber_profiles()
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.user_id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id IN (
    SELECT ms.user_id
    FROM public.member_subscriptions ms
    JOIN public.expert_plans ep ON ep.id = ms.plan_id
    JOIN public.experts e ON e.id = ep.expert_id
    WHERE e.user_id = auth.uid()
  );
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
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_signal_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  existing_record RECORD;
  sell_qty integer;
  remaining_qty integer;
  v_first text;
  v_market text;
  v_currency text;
  v_exists boolean;
  v_existing_trade_id uuid;
  v_unit text;
  v_asset_class text;
  v_trade_qty integer;
  v_inserted integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('published', 'pending') THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.status IN ('published', 'pending') THEN
    v_first := split_part(COALESCE(NEW.instrument, ''), ' ', 1);

    SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
      INTO v_asset_class
    FROM public.experts
    WHERE id = NEW.expert_id;

    v_asset_class := COALESCE(v_asset_class, 'tw_stock');

    v_market := CASE v_asset_class
      WHEN 'us_stock' THEN 'US'
      WHEN 'us_option' THEN 'US'
      WHEN 'us_future' THEN 'US'
      WHEN 'crypto' THEN 'CRYPTO'
      ELSE 'TW'
    END;

    v_currency := CASE v_asset_class
      WHEN 'us_stock' THEN 'USD'
      WHEN 'us_option' THEN 'USD'
      WHEN 'us_future' THEN 'USD'
      WHEN 'crypto' THEN 'USD'
      ELSE 'TWD'
    END;

    v_unit := COALESCE(
      NULLIF(btrim(NEW.quantity_unit), ''),
      CASE v_asset_class
        WHEN 'tw_stock' THEN '張'
        WHEN 'us_stock' THEN '股'
        WHEN 'crypto' THEN '顆'
        WHEN 'us_option' THEN '口'
        WHEN 'us_future' THEN '口'
        ELSE CASE WHEN v_currency = 'USD' THEN '股' ELSE '張' END
      END
    );

    v_trade_qty := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN v_asset_class = 'tw_stock' AND v_unit = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      ELSE COALESCE(NEW.quantity, 1)
    END;

    IF NEW.action IN ('buy', 'add', 'sell', 'trim', 'exit') THEN
      INSERT INTO public.signal_trade_applications (signal_id, expert_id, action, applied_quantity, tg_op)
      VALUES (NEW.id, NEW.expert_id, NEW.action::text, v_trade_qty, TG_OP)
      ON CONFLICT (signal_id) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      IF v_inserted = 0 THEN
        INSERT INTO public.function_run_logs
          (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
        VALUES (
          'handle_signal_trade',
          gen_random_uuid()::text,
          'info',
          'skipped_already_applied',
          format('signal %s 先前已套用過（%s），本次 %s 安全跳過（防重複）',
                 NEW.id, NEW.action, TG_OP),
          NEW.id,
          NEW.expert_id,
          jsonb_build_object(
            'action', NEW.action,
            'instrument', NEW.instrument,
            'tg_op', TG_OP,
            'quantity', NEW.quantity,
            'quantity_unit', v_unit,
            'trade_quantity', v_trade_qty,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;

      SELECT id INTO v_existing_trade_id FROM public.trade_records WHERE signal_id = NEW.id LIMIT 1;
      v_exists := v_existing_trade_id IS NOT NULL;
      IF v_exists THEN
        INSERT INTO public.function_run_logs
          (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
        VALUES (
          'handle_signal_trade',
          gen_random_uuid()::text,
          'info',
          'skipped_existing_trade',
          format('signal %s 已對應 trade_record %s，%s 動作安全跳過（防重複）',
                 NEW.id, v_existing_trade_id, NEW.action),
          NEW.id,
          NEW.expert_id,
          jsonb_build_object(
            'action', NEW.action,
            'instrument', NEW.instrument,
            'tg_op', TG_OP,
            'existing_trade_id', v_existing_trade_id,
            'quantity', NEW.quantity,
            'quantity_unit', v_unit,
            'trade_quantity', v_trade_qty,
            'asset_class', v_asset_class,
            'market', v_market,
            'currency', v_currency,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, v_trade_qty, v_unit, v_market, v_currency);

    ELSIF NEW.action = 'add' THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.trade_records
        SET entry_price = CASE
              WHEN (existing_record.quantity + v_trade_qty) > 0
              THEN ROUND(
                (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
                 + v_trade_qty * COALESCE(NEW.price_hint, 0))
                / (existing_record.quantity + v_trade_qty)
              , 2)
              ELSE existing_record.entry_price
            END,
            quantity = existing_record.quantity + v_trade_qty,
            quantity_unit = COALESCE(existing_record.quantity_unit, v_unit),
            market = COALESCE(market, v_market),
            currency = COALESCE(currency, v_currency)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, v_trade_qty, v_unit, v_market, v_currency);
      END IF;

    ELSIF NEW.action IN ('sell', 'trim') THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        sell_qty := LEAST(v_trade_qty, existing_record.quantity);
        remaining_qty := existing_record.quantity - sell_qty;

        IF remaining_qty <= 0 THEN
          UPDATE public.trade_records
          SET exit_price = NEW.price_hint,
              exit_date = COALESCE(NEW.published_at, NOW()),
              pnl_percent = CASE
                WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
                THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
                ELSE NULL
              END,
              quantity_unit = COALESCE(quantity_unit, existing_record.quantity_unit, v_unit),
              status = 'closed'::trade_status
          WHERE id = existing_record.id;
        ELSE
          UPDATE public.trade_records
          SET quantity = remaining_qty,
              quantity_unit = COALESCE(quantity_unit, existing_record.quantity_unit, v_unit)
          WHERE id = existing_record.id;

          INSERT INTO public.trade_records (
            expert_id, signal_id, instrument,
            entry_price, entry_date,
            exit_price, exit_date,
            pnl_percent, quantity, quantity_unit, status, market, currency
          ) VALUES (
            NEW.expert_id, NEW.id, NEW.instrument,
            existing_record.entry_price, existing_record.entry_date,
            NEW.price_hint, COALESCE(NEW.published_at, NOW()),
            CASE
              WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
              THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
              ELSE NULL
            END,
            sell_qty,
            COALESCE(existing_record.quantity_unit, v_unit),
            'closed'::trade_status,
            COALESCE(existing_record.market, v_market),
            COALESCE(existing_record.currency, v_currency)
          );
        END IF;
      END IF;

    ELSIF NEW.action = 'exit' THEN
      UPDATE public.trade_records
      SET exit_price = NEW.price_hint,
          exit_date = COALESCE(NEW.published_at, NOW()),
          pnl_percent = CASE
            WHEN entry_price IS NOT NULL AND entry_price > 0
            THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
            ELSE NULL
          END,
          quantity_unit = COALESCE(quantity_unit, v_unit),
          status = 'closed'::trade_status
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
 RETURNS TABLE(plan_id uuid, expert_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ms.plan_id, ep.expert_id
  FROM public.member_subscriptions ms
  JOIN public.expert_plans ep ON ep.id = ms.plan_id
  WHERE ms.user_id = _user_id
    AND ms.status = 'active'
    AND (ms.expires_at IS NULL OR ms.expires_at > now())
$function$
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
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_subscribed_to_plan(_user_id uuid, _plan_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.member_subscriptions
    WHERE user_id = _user_id
      AND plan_id = _plan_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
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
CREATE OR REPLACE FUNCTION public.protect_backtest_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Force these columns to retain their original values regardless of who updates
  -- Backtest KPIs must be system-calculated from trade_records, never manually edited
  NEW.backtest_1y_return := OLD.backtest_1y_return;
  NEW.backtest_max_drawdown := OLD.backtest_max_drawdown;
  NEW.backtest_annual_return := OLD.backtest_annual_return;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when invoked from edge functions with service role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- Block non-admin users from changing privileged fields
  IF NEW.is_tester IS DISTINCT FROM OLD.is_tester THEN
    RAISE EXCEPTION 'You cannot modify tester status';
  END IF;
  IF NEW.expert_slug IS DISTINCT FROM OLD.expert_slug THEN
    RAISE EXCEPTION 'You cannot modify expert slug';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role (edge functions) — auth.uid() is NULL when called with service role
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- For regular users, block changes to sensitive fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'You cannot modify subscription status';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'You cannot modify subscription expiry';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'You cannot modify subscription start date';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'You cannot modify subscription plan';
  END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'You cannot modify payment provider';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.realign_instrument_unit(p_expert_id uuid, p_symbol_prefix text, p_new_unit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_is_admin boolean;
  v_sig_count int := 0;
  v_tr_count int := 0;
  v_prefix text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF p_expert_id IS NULL OR p_symbol_prefix IS NULL OR p_new_unit IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;
  IF p_new_unit NOT IN ('張','股','顆','口') THEN
    RAISE EXCEPTION 'invalid_unit: %', p_new_unit;
  END IF;

  SELECT user_id, COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_owner, v_asset_class
  FROM public.experts WHERE id = p_expert_id;

  v_is_admin := public.has_role(v_uid, 'company_admin'::app_role);

  IF NOT v_is_admin AND (v_owner IS NULL OR v_owner <> v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 依 asset_class 允許的單位（與前端 asset.ts 對齊）
  v_allowed := CASE v_asset_class
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NOT (p_new_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      v_asset_class, p_new_unit, array_to_string(v_allowed, '/');
  END IF;

  v_prefix := trim(p_symbol_prefix) || '%';

  UPDATE public.expert_signals
  SET quantity_unit = p_new_unit
  WHERE expert_id = p_expert_id
    AND instrument ILIKE v_prefix
    AND quantity_unit IS DISTINCT FROM p_new_unit;
  GET DIAGNOSTICS v_sig_count = ROW_COUNT;

  UPDATE public.trade_records
  SET quantity_unit = p_new_unit
  WHERE expert_id = p_expert_id
    AND instrument ILIKE v_prefix
    AND quantity_unit IS DISTINCT FROM p_new_unit;
  GET DIAGNOSTICS v_tr_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'signals_updated', v_sig_count,
    'trades_updated', v_tr_count,
    'new_unit', p_new_unit,
    'asset_class', v_asset_class
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.recalc_user_summary_on_perf_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _remaining int;
  _total double precision;
  _avg double precision;
BEGIN
  SELECT count(*), coalesce(sum(pnl_percent), 0), coalesce(avg(pnl_percent), 0)
    INTO _remaining, _total, _avg
    FROM user_performances
   WHERE user_id = OLD.user_id;

  IF _remaining = 0 THEN
    UPDATE user_summaries
       SET total_pnl_percent = 0,
           avg_pnl_percent = 0,
           updated_at = now()
     WHERE user_id = OLD.user_id;
  ELSE
    UPDATE user_summaries
       SET total_pnl_percent = _total,
           avg_pnl_percent = _avg,
           updated_at = now()
     WHERE user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_signal_batch(_expert_id uuid, _batch_id uuid, _signals jsonb, _legs jsonb DEFAULT '[]'::jsonb, _is_editing boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _inserted integer := 0;
  _old_ids uuid[];
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = _caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _signals IS NULL OR jsonb_typeof(_signals) <> 'array' OR jsonb_array_length(_signals) = 0 THEN
    RAISE EXCEPTION 'empty_signals' USING ERRCODE = '22023';
  END IF;

  -- 所有 row 必須屬於同一位分析師與同一批次
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_signals) s
    WHERE (s->>'expert_id')::uuid IS DISTINCT FROM _expert_id
       OR (s->>'batch_id')::uuid IS DISTINCT FROM _batch_id
  ) THEN
    RAISE EXCEPTION 'batch_mismatch' USING ERRCODE = '22023';
  END IF;

  IF _is_editing THEN
    SELECT array_agg(id) INTO _old_ids
    FROM public.expert_signals
    WHERE batch_id = _batch_id AND expert_id = _expert_id;

    IF _old_ids IS NOT NULL AND array_length(_old_ids, 1) > 0 THEN
      DELETE FROM public.trade_records WHERE signal_id = ANY(_old_ids);
      DELETE FROM public.expert_signal_legs WHERE signal_id = ANY(_old_ids);
      DELETE FROM public.expert_signals WHERE id = ANY(_old_ids);
    END IF;
  END IF;

  WITH src AS (
    SELECT * FROM jsonb_populate_recordset(null::public.expert_signals, _signals)
  )
  INSERT INTO public.expert_signals (
    id, expert_id, plan_id, batch_id, instrument, action, price_hint,
    reason_summary, reason_detail, risk_notes, learning_points,
    status, published_at, created_at, quantity, quantity_unit,
    teaching_topic, overall_summary, executed_at,
    is_combo, combo_strategy, net_premium, max_loss_per_unit, max_profit_per_unit
  )
  SELECT
    COALESCE(src.id, gen_random_uuid()), _expert_id, src.plan_id, _batch_id, src.instrument,
    src.action, src.price_hint, src.reason_summary, src.reason_detail, src.risk_notes,
    src.learning_points, COALESCE(src.status, 'published'::signal_status),
    COALESCE(src.published_at, now()), COALESCE(src.created_at, now()),
    src.quantity, src.quantity_unit, src.teaching_topic, src.overall_summary,
    src.executed_at, COALESCE(src.is_combo, false), src.combo_strategy,
    src.net_premium, src.max_loss_per_unit, src.max_profit_per_unit
  FROM src;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  IF _legs IS NOT NULL AND jsonb_typeof(_legs) = 'array' AND jsonb_array_length(_legs) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(_legs) l
      WHERE NOT EXISTS (
        SELECT 1 FROM public.expert_signals es
        WHERE es.id = (l->>'signal_id')::uuid AND es.batch_id = _batch_id
      )
    ) THEN
      RAISE EXCEPTION 'leg_signal_mismatch' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.expert_signal_legs (
      signal_id, leg_index, occ_symbol, underlying, expiry, right_type,
      strike, side, ratio, leg_price
    )
    SELECT signal_id, leg_index, occ_symbol, underlying, expiry, right_type,
           strike, side, ratio, leg_price
    FROM jsonb_populate_recordset(null::public.expert_signal_legs, _legs);
  END IF;

  RETURN _inserted;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_expert_signal_market()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ac text;
  v_cur text;
BEGIN
  IF NEW.market IS NOT NULL AND NEW.market <> '' THEN
    RETURN NEW;
  END IF;

  SELECT asset_class, currency INTO v_ac, v_cur
    FROM public.experts WHERE id = NEW.expert_id;

  NEW.market := CASE
    WHEN v_ac = 'tw_stock' THEN 'TW'
    WHEN v_ac IN ('us_stock','us_option','us_future') THEN 'US'
    WHEN v_cur = 'TWD' THEN 'TW'
    WHEN v_cur = 'USD' THEN 'US'
    ELSE 'TW'
  END;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_plan_initial_review_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean;
BEGIN
  is_admin := has_role(auth.uid(), 'company_admin');
  
  IF NOT is_admin THEN
    -- Force pending for non-admin inserts
    NEW.review_status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.signal_in_subscription_window(_role expert_role, _started_at timestamp with time zone, _expires_at timestamp with time zone, _published_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _role = 'mentor' THEN
      (_published_at + INTERVAL '7 days') >= _started_at
      AND (_expires_at IS NULL OR _published_at <= _expires_at)
    ELSE
      _published_at >= _started_at
      AND (_expires_at IS NULL OR _published_at <= _expires_at)
  END
$function$
;
CREATE OR REPLACE FUNCTION public.sync_expert_currency_with_asset_class()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.asset_class = 'tw_stock' THEN
    NEW.currency := 'TWD';
  ELSIF NEW.asset_class IN ('us_stock','crypto','us_option','us_future') THEN
    NEW.currency := 'USD';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_expert_slug_to_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_display_name text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.slug IS NULL THEN
    RETURN NEW;
  END IF;

  -- Try update first
  UPDATE public.profiles
     SET expert_slug = NEW.slug
   WHERE user_id = NEW.user_id
     AND (expert_slug IS DISTINCT FROM NEW.slug);

  IF NOT FOUND THEN
    -- Insert new profile if missing
    SELECT COALESCE(u.raw_user_meta_data->>'display_name',
                    u.raw_user_meta_data->>'name',
                    split_part(u.email, '@', 1),
                    NEW.slug)
      INTO v_display_name
      FROM auth.users u
     WHERE u.id = NEW.user_id;

    INSERT INTO public.profiles (user_id, display_name, expert_slug)
    VALUES (NEW.user_id, COALESCE(v_display_name, NEW.slug), NEW.slug)
    ON CONFLICT (user_id) DO UPDATE
      SET expert_slug = EXCLUDED.expert_slug;
  END IF;

  RETURN NEW;
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
CREATE OR REPLACE FUNCTION public.trg_daily_snapshot_normalize_volume()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  n RECORD;
BEGIN
  IF NEW.volume IS NULL THEN
    NEW.volume_unit := COALESCE(NEW.volume_unit, 'unknown');
    NEW.volume_shares := NULL;
    RETURN NEW;
  END IF;

  IF NEW.volume_shares IS NULL OR NEW.volume_unit IS NULL THEN
    SELECT * INTO n FROM public.normalize_snapshot_volume_shares(NEW.market, NEW.volume, NEW.volume_unit);
    NEW.volume_unit := COALESCE(NEW.volume_unit, n.unit);
    NEW.volume_shares := COALESCE(NEW.volume_shares, n.shares);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_expert_ai_reindex()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT expert_id FROM changed_rows WHERE expert_id IS NOT NULL
  LOOP
    PERFORM net.http_post(
      url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/expert-ai-index',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo'
      ),
      body := jsonb_build_object('expert_id', rec.expert_id, 'trigger', TG_OP)
    );
  END LOOP;
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.tw_bsr_sync_queue_touch_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
DROP TRIGGER IF EXISTS enforce_plan_review_workflow_trigger ON public.expert_plans;
CREATE TRIGGER enforce_plan_review_workflow_trigger BEFORE UPDATE ON public.expert_plans FOR EACH ROW EXECUTE FUNCTION enforce_plan_review_workflow();
DROP TRIGGER IF EXISTS set_plan_initial_review_status_trigger ON public.expert_plans;
CREATE TRIGGER set_plan_initial_review_status_trigger BEFORE INSERT ON public.expert_plans FOR EACH ROW EXECUTE FUNCTION set_plan_initial_review_status();
DROP TRIGGER IF EXISTS trg_expert_signal_legs_updated_at ON public.expert_signal_legs;
CREATE TRIGGER trg_expert_signal_legs_updated_at BEFORE UPDATE ON public.expert_signal_legs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS enforce_signal_capital_limit_trg ON public.expert_signals;
CREATE TRIGGER enforce_signal_capital_limit_trg BEFORE INSERT OR UPDATE OF status, quantity, quantity_unit, price_hint, action ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION enforce_signal_capital_limit();
DROP TRIGGER IF EXISTS expert_signals_ai_reindex_del ON public.expert_signals;
CREATE TRIGGER expert_signals_ai_reindex_del AFTER DELETE ON public.expert_signals REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_expert_ai_reindex();
DROP TRIGGER IF EXISTS expert_signals_ai_reindex_ins ON public.expert_signals;
CREATE TRIGGER expert_signals_ai_reindex_ins AFTER INSERT ON public.expert_signals REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_expert_ai_reindex();
DROP TRIGGER IF EXISTS expert_signals_ai_reindex_upd ON public.expert_signals;
CREATE TRIGGER expert_signals_ai_reindex_upd AFTER UPDATE ON public.expert_signals REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_expert_ai_reindex();
DROP TRIGGER IF EXISTS on_signal_insert_or_update ON public.expert_signals;
CREATE TRIGGER on_signal_insert_or_update AFTER INSERT OR UPDATE ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION handle_signal_trade();
DROP TRIGGER IF EXISTS trg_audit_expert_signals_del ON public.expert_signals;
CREATE TRIGGER trg_audit_expert_signals_del AFTER DELETE ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_expert_signals_ins ON public.expert_signals;
CREATE TRIGGER trg_audit_expert_signals_ins AFTER INSERT ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_expert_signals_upd ON public.expert_signals;
CREATE TRIGGER trg_audit_expert_signals_upd AFTER UPDATE ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS trg_enforce_signal_recall_same_day_del ON public.expert_signals;
CREATE TRIGGER trg_enforce_signal_recall_same_day_del BEFORE DELETE ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION enforce_signal_recall_same_day();
DROP TRIGGER IF EXISTS trg_enforce_unit_consistency_expert_signals ON public.expert_signals;
CREATE TRIGGER trg_enforce_unit_consistency_expert_signals BEFORE INSERT OR UPDATE OF quantity_unit, instrument, expert_id ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION enforce_unit_consistency();
DROP TRIGGER IF EXISTS trg_set_expert_signal_market ON public.expert_signals;
CREATE TRIGGER trg_set_expert_signal_market BEFORE INSERT OR UPDATE OF market, expert_id ON public.expert_signals FOR EACH ROW EXECUTE FUNCTION set_expert_signal_market();
DROP TRIGGER IF EXISTS protect_experts_backtest_fields ON public.experts;
CREATE TRIGGER protect_experts_backtest_fields BEFORE UPDATE ON public.experts FOR EACH ROW EXECUTE FUNCTION protect_backtest_fields();
DROP TRIGGER IF EXISTS trg_enforce_expert_asset_class_lock ON public.experts;
CREATE TRIGGER trg_enforce_expert_asset_class_lock BEFORE UPDATE OF asset_class ON public.experts FOR EACH ROW EXECUTE FUNCTION enforce_expert_asset_class_lock();
DROP TRIGGER IF EXISTS trg_enforce_expert_currency_lock ON public.experts;
CREATE TRIGGER trg_enforce_expert_currency_lock BEFORE UPDATE OF currency ON public.experts FOR EACH ROW EXECUTE FUNCTION enforce_expert_currency_lock();
DROP TRIGGER IF EXISTS trg_sync_expert_currency ON public.experts;
CREATE TRIGGER trg_sync_expert_currency BEFORE INSERT OR UPDATE OF asset_class ON public.experts FOR EACH ROW EXECUTE FUNCTION sync_expert_currency_with_asset_class();
DROP TRIGGER IF EXISTS trg_sync_expert_slug_to_profile ON public.experts;
CREATE TRIGGER trg_sync_expert_slug_to_profile AFTER INSERT OR UPDATE OF slug, user_id ON public.experts FOR EACH ROW EXECUTE FUNCTION sync_expert_slug_to_profile();
DROP TRIGGER IF EXISTS audit_holdings_fix_proposals ON public.holdings_fix_proposals;
CREATE TRIGGER audit_holdings_fix_proposals AFTER INSERT OR DELETE OR UPDATE ON public.holdings_fix_proposals FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS holdings_fix_proposals_updated_at ON public.holdings_fix_proposals;
CREATE TRIGGER holdings_fix_proposals_updated_at BEFORE UPDATE ON public.holdings_fix_proposals FOR EACH ROW EXECUTE FUNCTION tg_holdings_fix_proposals_updated_at();
DROP TRIGGER IF EXISTS trg_protect_subscription_fields ON public.member_subscriptions;
CREATE TRIGGER trg_protect_subscription_fields BEFORE UPDATE ON public.member_subscriptions FOR EACH ROW EXECUTE FUNCTION protect_subscription_fields();
DROP TRIGGER IF EXISTS trg_enforce_payment_provider_default_active ON public.payment_providers;
CREATE TRIGGER trg_enforce_payment_provider_default_active BEFORE INSERT OR UPDATE ON public.payment_providers FOR EACH ROW EXECUTE FUNCTION enforce_payment_provider_default_active();
DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_fields();
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_audit_trade_records_del ON public.trade_records;
CREATE TRIGGER trg_audit_trade_records_del AFTER DELETE ON public.trade_records FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_trade_records_ins ON public.trade_records;
CREATE TRIGGER trg_audit_trade_records_ins AFTER INSERT ON public.trade_records FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_trade_records_upd ON public.trade_records;
CREATE TRIGGER trg_audit_trade_records_upd AFTER UPDATE ON public.trade_records FOR EACH ROW EXECUTE FUNCTION audit_row_change();
DROP TRIGGER IF EXISTS trg_enforce_trade_record_market_currency ON public.trade_records;
CREATE TRIGGER trg_enforce_trade_record_market_currency BEFORE INSERT OR UPDATE OF market, currency ON public.trade_records FOR EACH ROW EXECUTE FUNCTION enforce_trade_record_market_currency();
DROP TRIGGER IF EXISTS trg_enforce_unit_consistency_trade_records ON public.trade_records;
CREATE TRIGGER trg_enforce_unit_consistency_trade_records BEFORE INSERT OR UPDATE OF quantity_unit, instrument, expert_id ON public.trade_records FOR EACH ROW EXECUTE FUNCTION enforce_unit_consistency();
DROP TRIGGER IF EXISTS trg_trade_records_bsr_first_fetch ON public.trade_records;
CREATE TRIGGER trg_trade_records_bsr_first_fetch AFTER INSERT ON public.trade_records FOR EACH ROW EXECUTE FUNCTION enqueue_bsr_first_fetch_on_trade();
DROP TRIGGER IF EXISTS enforce_snapshot_immutability ON public.tw_bsr_daily;
CREATE TRIGGER enforce_snapshot_immutability BEFORE DELETE OR UPDATE ON public.tw_bsr_daily FOR EACH ROW EXECUTE FUNCTION enforce_snapshot_immutability();
DROP TRIGGER IF EXISTS trg_tw_bsr_daily_immutable ON public.tw_bsr_daily;
CREATE TRIGGER trg_tw_bsr_daily_immutable BEFORE DELETE OR UPDATE ON public.tw_bsr_daily FOR EACH ROW EXECUTE FUNCTION enforce_snapshot_immutability();
DROP TRIGGER IF EXISTS trg_tw_bsr_sync_queue_updated ON public.tw_bsr_sync_queue;
CREATE TRIGGER trg_tw_bsr_sync_queue_updated BEFORE UPDATE ON public.tw_bsr_sync_queue FOR EACH ROW EXECUTE FUNCTION tw_bsr_sync_queue_touch_updated();
DROP TRIGGER IF EXISTS trg_recalc_summary_on_perf_delete ON public.user_performances;
CREATE TRIGGER trg_recalc_summary_on_perf_delete AFTER DELETE ON public.user_performances FOR EACH ROW EXECUTE FUNCTION recalc_user_summary_on_perf_delete();
DROP TRIGGER IF EXISTS trg_user_performances_price_guard ON public.user_performances;
CREATE TRIGGER trg_user_performances_price_guard BEFORE INSERT OR UPDATE ON public.user_performances FOR EACH ROW EXECUTE FUNCTION enforce_user_performance_price();
