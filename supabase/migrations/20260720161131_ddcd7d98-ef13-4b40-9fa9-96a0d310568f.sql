
CREATE OR REPLACE FUNCTION public.bsr_apply_degrade_transition(
  _api text,
  _to_mode text,
  _reason text,
  _trigger_metric text,
  _trigger_value numeric,
  _threshold numeric,
  _cooldown_seconds integer,
  _correlation_id uuid DEFAULT NULL
) RETURNS TABLE(from_mode text, to_mode text, applied boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from text := 'normal';
  _now timestamptz := now();
  _cooldown timestamptz;
  _cfg jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bsr_degrade_' || _api));

  SELECT COALESCE(config->>'mode', 'normal') INTO _from
    FROM public.tw_bsr_sync_config WHERE key = 'degrade:' || _api;
  IF _from IS NULL THEN _from := 'normal'; END IF;

  IF _from = _to_mode THEN
    RETURN QUERY SELECT _from, _to_mode, false;
    RETURN;
  END IF;

  _cooldown := _now + make_interval(secs => GREATEST(0, COALESCE(_cooldown_seconds, 600)));
  _cfg := jsonb_build_object(
      'mode', _to_mode,
      'since', _now,
      'reason', _reason,
      'trigger_metric', _trigger_metric,
      'trigger_value', _trigger_value,
      'threshold', _threshold,
      'last_transition_at', _now,
      'cooldown_until', _cooldown,
      'previous_mode', _from
    );

  -- 直接 UPDATE：trigger 會自動遞增 version 並寫 history
  UPDATE public.tw_bsr_sync_config
     SET config = _cfg, note = 'auto-degrade', updated_at = _now
   WHERE key = 'degrade:' || _api;

  IF NOT FOUND THEN
    INSERT INTO public.tw_bsr_sync_config(key, config, note)
    VALUES ('degrade:' || _api, _cfg, 'auto-degrade');
  END IF;

  INSERT INTO public.tw_bsr_degrade_events(api_name, from_mode, to_mode, reason, trigger_metric, trigger_value, threshold, correlation_id, detail)
  VALUES (_api, _from, _to_mode, _reason, _trigger_metric, _trigger_value, _threshold, _correlation_id, '{}'::jsonb);

  RETURN QUERY SELECT _from, _to_mode, true;
END;
$$;
