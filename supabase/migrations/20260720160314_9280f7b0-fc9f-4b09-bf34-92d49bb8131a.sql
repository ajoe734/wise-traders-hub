
-- 1) correlation_id columns
ALTER TABLE public.tw_bsr_sync_queue ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.tw_bsr_api_reservations ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.tw_bsr_fetch_failures ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.tw_bsr_attempt_logs ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS tw_bsr_sync_queue_cid_idx ON public.tw_bsr_sync_queue (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tw_bsr_api_reservations_cid_idx ON public.tw_bsr_api_reservations (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tw_bsr_fetch_failures_cid_idx ON public.tw_bsr_fetch_failures (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tw_bsr_attempt_logs_cid_idx ON public.tw_bsr_attempt_logs (correlation_id) WHERE correlation_id IS NOT NULL;

-- 2) degrade events audit table
CREATE TABLE IF NOT EXISTS public.tw_bsr_degrade_events (
  id bigserial PRIMARY KEY,
  api_name text NOT NULL DEFAULT 'finmind',
  from_mode text NOT NULL,
  to_mode text NOT NULL,
  reason text NOT NULL,
  trigger_metric text,
  trigger_value numeric,
  threshold numeric,
  correlation_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tw_bsr_degrade_events TO authenticated;
GRANT ALL ON public.tw_bsr_degrade_events TO service_role;
ALTER TABLE public.tw_bsr_degrade_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_admin_can_read_bsr_degrade" ON public.tw_bsr_degrade_events;
CREATE POLICY "company_admin_can_read_bsr_degrade" ON public.tw_bsr_degrade_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));

DROP POLICY IF EXISTS "service_role_manages_bsr_degrade" ON public.tw_bsr_degrade_events;
CREATE POLICY "service_role_manages_bsr_degrade" ON public.tw_bsr_degrade_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS tw_bsr_degrade_events_recent_idx ON public.tw_bsr_degrade_events (api_name, created_at DESC);

-- 3) rewrite reserve_bsr_api_quota with optional correlation_id
DROP FUNCTION IF EXISTS public.reserve_bsr_api_quota(integer, text, integer);
DROP FUNCTION IF EXISTS public.reserve_bsr_api_quota(integer, text, integer, uuid);

CREATE OR REPLACE FUNCTION public.reserve_bsr_api_quota(
  _limit integer,
  _api text,
  _lease_seconds integer,
  _correlation_id uuid DEFAULT NULL
) RETURNS TABLE(granted boolean, reservation_id bigint, used integer, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _window_start timestamptz := now() - interval '1 hour';
  _used integer;
  _in_flight integer;
  _total integer;
  _new_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bsr_reserve_' || _api));

  UPDATE public.tw_bsr_api_reservations
     SET released = true, settled_at = now()
   WHERE api_name = _api AND settled_at IS NULL AND released = false AND expires_at < now();

  SELECT COALESCE(SUM(call_count), 0) INTO _used
    FROM public.tw_bsr_api_usage
   WHERE api_name = _api AND bucket_start >= _window_start;

  SELECT COUNT(*) INTO _in_flight
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api AND settled_at IS NULL AND released = false;

  _total := _used + _in_flight;

  IF _total >= _limit THEN
    RETURN QUERY SELECT false, NULL::bigint, _total, GREATEST(0, _limit - _total);
    RETURN;
  END IF;

  INSERT INTO public.tw_bsr_api_reservations(api_name, reserved_at, expires_at, correlation_id)
  VALUES (_api, now(), now() + make_interval(secs => GREATEST(1, _lease_seconds)), _correlation_id)
  RETURNING id INTO _new_id;

  RETURN QUERY SELECT true, _new_id, _total + 1, GREATEST(0, _limit - (_total + 1));
END;
$$;

-- 4) degrade RPCs
CREATE OR REPLACE FUNCTION public.bsr_get_degrade_state(_api text DEFAULT 'finmind')
RETURNS TABLE(
  mode text,
  since timestamptz,
  reason text,
  trigger_metric text,
  trigger_value numeric,
  last_transition_at timestamptz,
  cooldown_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cfg jsonb;
BEGIN
  SELECT config INTO _cfg FROM public.tw_bsr_sync_config WHERE key = 'degrade:' || _api;
  IF _cfg IS NULL THEN
    RETURN QUERY SELECT 'normal'::text, now(), 'initial'::text, NULL::text, NULL::numeric, now(), now();
    RETURN;
  END IF;
  RETURN QUERY SELECT
    COALESCE(_cfg->>'mode', 'normal'),
    COALESCE((_cfg->>'since')::timestamptz, now()),
    COALESCE(_cfg->>'reason', ''),
    _cfg->>'trigger_metric',
    NULLIF(_cfg->>'trigger_value','')::numeric,
    COALESCE((_cfg->>'last_transition_at')::timestamptz, now()),
    COALESCE((_cfg->>'cooldown_until')::timestamptz, now());
END;
$$;

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

  INSERT INTO public.tw_bsr_sync_config(key, config, note, updated_at)
  VALUES (
    'degrade:' || _api,
    jsonb_build_object(
      'mode', _to_mode,
      'since', _now,
      'reason', _reason,
      'trigger_metric', _trigger_metric,
      'trigger_value', _trigger_value,
      'threshold', _threshold,
      'last_transition_at', _now,
      'cooldown_until', _cooldown,
      'previous_mode', _from
    ),
    'auto-degrade',
    _now
  )
  ON CONFLICT (key) DO UPDATE SET config = EXCLUDED.config, updated_at = _now, note = 'auto-degrade';

  INSERT INTO public.tw_bsr_degrade_events(api_name, from_mode, to_mode, reason, trigger_metric, trigger_value, threshold, correlation_id, detail)
  VALUES (_api, _from, _to_mode, _reason, _trigger_metric, _trigger_value, _threshold, _correlation_id, '{}'::jsonb);

  RETURN QUERY SELECT _from, _to_mode, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.bsr_recent_degrade_events(_api text DEFAULT 'finmind', _limit integer DEFAULT 30)
RETURNS TABLE(id bigint, from_mode text, to_mode text, reason text, trigger_metric text, trigger_value numeric, threshold numeric, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, from_mode, to_mode, reason, trigger_metric, trigger_value, threshold, created_at
    FROM public.tw_bsr_degrade_events
   WHERE api_name = _api
   ORDER BY created_at DESC
   LIMIT GREATEST(1, LEAST(200, _limit));
$$;

CREATE OR REPLACE FUNCTION public.bsr_trace_by_correlation(_cid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'correlation_id', _cid,
    'queue', (SELECT COALESCE(jsonb_agg(to_jsonb(q.*) ORDER BY q.enqueued_at), '[]'::jsonb)
                FROM public.tw_bsr_sync_queue q WHERE q.correlation_id = _cid),
    'reservations', (SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.reserved_at), '[]'::jsonb)
                FROM public.tw_bsr_api_reservations r WHERE r.correlation_id = _cid),
    'failures', (SELECT COALESCE(jsonb_agg(to_jsonb(f.*) ORDER BY f.created_at), '[]'::jsonb)
                FROM public.tw_bsr_fetch_failures f WHERE f.correlation_id = _cid),
    'attempts', (SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.attempted_at), '[]'::jsonb)
                FROM public.tw_bsr_attempt_logs a WHERE a.correlation_id = _cid),
    'degrade_events', (SELECT COALESCE(jsonb_agg(to_jsonb(d.*) ORDER BY d.created_at), '[]'::jsonb)
                FROM public.tw_bsr_degrade_events d WHERE d.correlation_id = _cid)
  );
$$;

INSERT INTO public.tw_bsr_sync_config(key, config, note)
VALUES ('degrade:finmind', jsonb_build_object(
  'mode','normal','since', now(),'reason','initial',
  'last_transition_at', now(),'cooldown_until', now()
), 'seed')
ON CONFLICT (key) DO NOTHING;
