
-- Commit 1: Analytics infra — is_internal column + 180-day retention

ALTER TABLE public.traffic_events
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_traffic_events_is_internal
  ON public.traffic_events (is_internal, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_traffic_events_props_instrument
  ON public.traffic_events ((event_props->>'instrument'))
  WHERE event_props ? 'instrument';

-- Bump retention from 90 → 180 days
CREATE OR REPLACE FUNCTION public.cleanup_old_traffic()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.traffic_events WHERE occurred_at < now() - interval '180 days';
  DELETE FROM public.traffic_visits WHERE last_seen_at < now() - interval '365 days' AND user_id IS NULL;
END;
$$;
