CREATE OR REPLACE FUNCTION public.save_signal_batch(
  _expert_id uuid,
  _batch_id uuid,
  _signals jsonb,
  _legs jsonb DEFAULT '[]'::jsonb,
  _is_editing boolean DEFAULT false
)
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
$function$;

REVOKE ALL ON FUNCTION public.save_signal_batch(uuid, uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_signal_batch(uuid, uuid, jsonb, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_signal_batch(uuid, uuid, jsonb, jsonb, boolean) TO service_role;