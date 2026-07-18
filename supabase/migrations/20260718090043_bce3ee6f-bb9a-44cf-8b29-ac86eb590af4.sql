CREATE OR REPLACE FUNCTION public.get_owned_journal_bundle(_signal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_signal record;
  v_expert record;
  v_week jsonb;
  v_ws timestamptz;
  v_we timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.* INTO v_signal FROM public.expert_signals s WHERE s.id = _signal_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT e.* INTO v_expert FROM public.experts e WHERE e.id = v_signal.expert_id;
  IF NOT FOUND OR v_expert.user_id <> v_uid THEN
    RETURN NULL;
  END IF;

  v_ws := date_trunc('week', v_signal.published_at);
  v_we := v_ws + interval '4 days 23 hours 59 minutes 59 seconds';

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'instrument', s.instrument,
      'action', s.action,
      'price_hint', s.price_hint,
      'quantity', s.quantity,
      'quantity_unit', s.quantity_unit,
      'reason_summary', s.reason_summary,
      'reason_detail', s.reason_detail,
      'risk_notes', s.risk_notes,
      'learning_points', s.learning_points,
      'published_at', s.published_at,
      'expert_id', s.expert_id,
      'experts', jsonb_build_object(
        'name', v_expert.name,
        'slug', v_expert.slug,
        'role', v_expert.role,
        'avatar_url', v_expert.avatar_url,
        'currency', v_expert.currency
      )
    ) ORDER BY s.published_at DESC
  ) INTO v_week
  FROM public.expert_signals s
  WHERE s.expert_id = v_signal.expert_id
    AND s.status = 'published'
    AND s.published_at >= v_ws
    AND s.published_at <= v_we;

  RETURN jsonb_build_object(
    'signal', jsonb_build_object(
      'id', v_signal.id,
      'instrument', v_signal.instrument,
      'action', v_signal.action,
      'price_hint', v_signal.price_hint,
      'quantity', v_signal.quantity,
      'quantity_unit', v_signal.quantity_unit,
      'reason_summary', v_signal.reason_summary,
      'reason_detail', v_signal.reason_detail,
      'risk_notes', v_signal.risk_notes,
      'learning_points', v_signal.learning_points,
      'published_at', v_signal.published_at,
      'expert_id', v_signal.expert_id,
      'experts', jsonb_build_object(
        'name', v_expert.name,
        'slug', v_expert.slug,
        'role', v_expert.role,
        'avatar_url', v_expert.avatar_url,
        'currency', v_expert.currency
      )
    ),
    'weekSignals', COALESCE(v_week, '[]'::jsonb)
  );
END;
$function$;