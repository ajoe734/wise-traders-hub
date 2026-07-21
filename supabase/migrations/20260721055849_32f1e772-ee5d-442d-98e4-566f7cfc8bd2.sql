CREATE OR REPLACE FUNCTION public.realign_instrument_unit(
  p_expert_id uuid,
  p_symbol_prefix text,
  p_new_unit text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_is_admin boolean;
  v_sig_count int := 0;
  v_tr_count int := 0;
  v_prefix text;
BEGIN
  IF p_expert_id IS NULL OR p_symbol_prefix IS NULL OR p_new_unit IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;
  IF p_new_unit NOT IN ('張','股','顆','口') THEN
    RAISE EXCEPTION 'invalid_unit: %', p_new_unit;
  END IF;

  SELECT user_id INTO v_owner FROM public.experts WHERE id = p_expert_id;
  v_is_admin := public.has_role(v_uid, 'company_admin'::app_role);

  IF NOT v_is_admin AND (v_owner IS NULL OR v_owner <> v_uid) THEN
    RAISE EXCEPTION 'forbidden';
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
    'new_unit', p_new_unit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.realign_instrument_unit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.realign_instrument_unit(uuid, text, text) TO authenticated;
