
-- ============================================================
-- M3 v2: Snapshot-First × Elastic Share × Coalesced Fetch
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tw_bsr_daily_snapshot_status (
  trade_date        date PRIMARY KEY,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','fetching','ready','partial','exhausted','failed')),
  source            text
    CHECK (source IS NULL OR source IN ('finmind_market_batch','finmind_per_stock','manual')),
  fetched_at        timestamptz,
  coverage_stocks   integer NOT NULL DEFAULT 0,
  coverage_rows     integer NOT NULL DEFAULT 0,
  attempt_count     integer NOT NULL DEFAULT 0,
  last_error        text,
  correlation_id    uuid,
  lock_expires_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsr_snapshot_status_status
  ON public.tw_bsr_daily_snapshot_status (status, trade_date DESC);

GRANT SELECT ON public.tw_bsr_daily_snapshot_status TO authenticated;
GRANT ALL    ON public.tw_bsr_daily_snapshot_status TO service_role;

ALTER TABLE public.tw_bsr_daily_snapshot_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read snapshot status" ON public.tw_bsr_daily_snapshot_status;
CREATE POLICY "admin read snapshot status"
  ON public.tw_bsr_daily_snapshot_status FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

DROP TRIGGER IF EXISTS tw_bsr_snapshot_status_touch ON public.tw_bsr_daily_snapshot_status;
CREATE TRIGGER tw_bsr_snapshot_status_touch
  BEFORE UPDATE ON public.tw_bsr_daily_snapshot_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.tw_bsr_api_reservations
  ADD COLUMN IF NOT EXISTS tier smallint;

CREATE INDEX IF NOT EXISTS idx_bsr_reservations_tier_time
  ON public.tw_bsr_api_reservations (api_name, tier, reserved_at DESC);

CREATE OR REPLACE FUNCTION public.reserve_bsr_api_quota(
  _limit integer,
  _api text,
  _lease_seconds integer,
  _correlation_id uuid DEFAULT NULL,
  _tier smallint DEFAULT NULL
) RETURNS TABLE(granted boolean, reservation_id bigint, used integer, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
  v_since timestamptz := now() - interval '1 hour';
  v_new_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bsr_quota:' || _api, 0));

  SELECT COUNT(*) INTO v_used
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api
     AND reserved_at >= v_since
     AND released = false
     AND (settled_at IS NOT NULL OR expires_at > now());

  IF v_used >= _limit THEN
    RETURN QUERY SELECT false, NULL::bigint, v_used, GREATEST(0, _limit - v_used);
    RETURN;
  END IF;

  INSERT INTO public.tw_bsr_api_reservations
    (api_name, reserved_at, expires_at, correlation_id, tier)
  VALUES
    (_api, now(), now() + make_interval(secs => _lease_seconds), _correlation_id, _tier)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT true, v_new_id, v_used + 1, GREATEST(0, _limit - v_used - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_bsr_api_quota(integer,text,integer,uuid,smallint) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_bsr_api_quota(integer,text,integer,uuid,smallint) TO service_role;

CREATE OR REPLACE FUNCTION public.bsr_check_tier_admission(
  _api  text  DEFAULT 'finmind',
  _tier smallint DEFAULT 3,
  _limit integer DEFAULT 1500
) RETURNS TABLE(
  allowed boolean,
  reason  text,
  hourly_used integer,
  tier_used integer,
  tier_guarantee integer,
  available_for_tier integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - interval '1 hour';
  v_used  integer;
  v_used_t1 integer;
  v_used_t2 integer;
  v_used_t3 integer;
  v_g1 integer := (_limit * 40) / 100;
  v_g2 integer := (_limit * 20) / 100;
  v_g3 integer := (_limit *  5) / 100;
  v_tier_used integer;
  v_tier_g integer;
  v_reserved_by_higher integer;
  v_available integer;
BEGIN
  SELECT COUNT(*) INTO v_used
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api AND reserved_at >= v_since AND released = false
     AND (settled_at IS NOT NULL OR expires_at > now());

  SELECT
    COUNT(*) FILTER (WHERE tier = 1),
    COUNT(*) FILTER (WHERE tier = 2),
    COUNT(*) FILTER (WHERE tier = 3 OR tier IS NULL)
  INTO v_used_t1, v_used_t2, v_used_t3
    FROM public.tw_bsr_api_reservations
   WHERE api_name = _api AND reserved_at >= v_since AND released = false
     AND (settled_at IS NOT NULL OR expires_at > now());

  IF _tier = 1 THEN
    v_tier_used := v_used_t1; v_tier_g := v_g1; v_reserved_by_higher := 0;
  ELSIF _tier = 2 THEN
    v_tier_used := v_used_t2; v_tier_g := v_g2;
    v_reserved_by_higher := GREATEST(0, v_g1 - v_used_t1);
  ELSE
    v_tier_used := v_used_t3; v_tier_g := v_g3;
    v_reserved_by_higher := GREATEST(0, v_g1 - v_used_t1) + GREATEST(0, v_g2 - v_used_t2);
  END IF;

  v_available := _limit - v_used - v_reserved_by_higher;

  IF v_available > 0 THEN
    RETURN QUERY SELECT true, 'ok'::text, v_used, v_tier_used, v_tier_g, v_available;
    RETURN;
  END IF;

  IF v_tier_used < v_tier_g THEN
    RETURN QUERY SELECT true, 'min_guarantee'::text, v_used, v_tier_used, v_tier_g,
                        v_tier_g - v_tier_used;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'squeezed_by_higher_tier'::text, v_used, v_tier_used, v_tier_g, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.bsr_check_tier_admission(text,smallint,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.bsr_check_tier_admission(text,smallint,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.bsr_snapshot_claim(
  _trade_date date,
  _correlation_id uuid,
  _lease_seconds integer DEFAULT 90
) RETURNS TABLE(claimed boolean, prev_status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
  v_new_attempts integer;
BEGIN
  INSERT INTO public.tw_bsr_daily_snapshot_status(trade_date, status)
  VALUES (_trade_date, 'pending')
  ON CONFLICT (trade_date) DO NOTHING;

  SELECT status INTO v_prev
    FROM public.tw_bsr_daily_snapshot_status WHERE trade_date = _trade_date;

  IF v_prev IN ('ready','exhausted') THEN
    RETURN QUERY SELECT false, v_prev, 0;
    RETURN;
  END IF;

  UPDATE public.tw_bsr_daily_snapshot_status
     SET status = 'fetching',
         correlation_id = _correlation_id,
         lock_expires_at = now() + make_interval(secs => _lease_seconds),
         attempt_count = attempt_count + 1
   WHERE trade_date = _trade_date
     AND (
       status IN ('pending','partial','failed')
       OR (status = 'fetching' AND (lock_expires_at IS NULL OR lock_expires_at < now()))
     )
   RETURNING attempt_count INTO v_new_attempts;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_prev, v_new_attempts;
  ELSE
    RETURN QUERY SELECT false, v_prev, 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bsr_snapshot_claim(date,uuid,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.bsr_snapshot_claim(date,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.bsr_snapshot_mark(
  _trade_date date,
  _status text,
  _source text,
  _coverage_stocks integer,
  _coverage_rows integer,
  _last_error text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.tw_bsr_daily_snapshot_status
     SET status = _status,
         source = COALESCE(_source, source),
         fetched_at = CASE WHEN _status IN ('ready','partial') THEN now() ELSE fetched_at END,
         coverage_stocks = GREATEST(coverage_stocks, COALESCE(_coverage_stocks, 0)),
         coverage_rows   = GREATEST(coverage_rows,   COALESCE(_coverage_rows, 0)),
         last_error = _last_error,
         lock_expires_at = NULL
   WHERE trade_date = _trade_date;
$$;

REVOKE ALL ON FUNCTION public.bsr_snapshot_mark(date,text,text,integer,integer,text) FROM public;
GRANT EXECUTE ON FUNCTION public.bsr_snapshot_mark(date,text,text,integer,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.bsr_snapshot_fulfill_jobs(
  _trade_date date,
  _threshold integer DEFAULT 5
) RETURNS TABLE(fulfilled integer, still_pending integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done integer;
  v_pending integer;
BEGIN
  WITH sufficient AS (
    SELECT stock_id
      FROM public.tw_bsr_daily
     WHERE trade_date = _trade_date
     GROUP BY stock_id
    HAVING COUNT(*) >= _threshold
  ),
  updated AS (
    UPDATE public.tw_bsr_sync_queue q
       SET status = 'done',
           finished_at = now(),
           last_success_at = now(),
           last_error = NULL,
           next_run_at = now()
      FROM sufficient s
     WHERE q.trade_date = _trade_date
       AND q.stock_id = s.stock_id
       AND q.status IN ('pending','running')
     RETURNING q.id
  )
  SELECT COUNT(*) INTO v_done FROM updated;

  SELECT COUNT(*) INTO v_pending
    FROM public.tw_bsr_sync_queue
   WHERE trade_date = _trade_date AND status IN ('pending','running');

  RETURN QUERY SELECT COALESCE(v_done, 0)::integer, COALESCE(v_pending, 0)::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.bsr_snapshot_fulfill_jobs(date,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.bsr_snapshot_fulfill_jobs(date,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.bsr_snapshot_stats(_days integer DEFAULT 7)
RETURNS TABLE(
  total_days integer,
  ready_days integer,
  partial_days integer,
  exhausted_days integer,
  hit_ratio_24h numeric,
  quota_per_day_avg numeric,
  oldest_pending_days integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since date := ((now() at time zone 'Asia/Taipei')::date - _days);
  v_finished_last_24h integer;
  v_fulfilled_last_24h integer;
  v_calls_last_24h integer;
  v_days_last_24h integer;
BEGIN
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE status = 'ready')::integer,
    COUNT(*) FILTER (WHERE status = 'partial')::integer,
    COUNT(*) FILTER (WHERE status = 'exhausted')::integer
  INTO total_days, ready_days, partial_days, exhausted_days
    FROM public.tw_bsr_daily_snapshot_status
   WHERE trade_date >= v_since;

  SELECT COUNT(*) INTO v_finished_last_24h
    FROM public.tw_bsr_sync_queue
   WHERE status = 'done' AND finished_at >= now() - interval '24 hours';

  SELECT COUNT(*) INTO v_fulfilled_last_24h
    FROM public.tw_bsr_sync_queue q
    JOIN public.tw_bsr_daily_snapshot_status s ON s.trade_date = q.trade_date
   WHERE q.status = 'done'
     AND q.finished_at >= now() - interval '24 hours'
     AND s.fetched_at IS NOT NULL
     AND ABS(EXTRACT(EPOCH FROM (q.finished_at - s.fetched_at))) < 5;

  hit_ratio_24h := CASE WHEN v_finished_last_24h > 0
                        THEN ROUND(v_fulfilled_last_24h::numeric / v_finished_last_24h * 100, 2)
                        ELSE NULL END;

  SELECT COUNT(*), COUNT(DISTINCT (reserved_at at time zone 'Asia/Taipei')::date)
    INTO v_calls_last_24h, v_days_last_24h
    FROM public.tw_bsr_api_reservations
   WHERE api_name = 'finmind' AND reserved_at >= now() - interval '24 hours'
     AND released = false;

  quota_per_day_avg := CASE WHEN v_days_last_24h > 0
                            THEN ROUND(v_calls_last_24h::numeric / v_days_last_24h, 2)
                            ELSE NULL END;

  SELECT COALESCE(EXTRACT(DAY FROM now() - MIN(created_at))::integer, 0)
    INTO oldest_pending_days
    FROM public.tw_bsr_daily_snapshot_status
   WHERE status IN ('pending','partial','fetching');

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.bsr_snapshot_stats(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.bsr_snapshot_stats(integer) TO authenticated, service_role;

INSERT INTO public.tw_bsr_sync_config(key, config, note)
VALUES ('market_batch',
        jsonb_build_object(
          'enabled', true,
          'supported', null,
          'probed_at', null,
          'min_stocks_in_response', 500,
          'threshold_pending', 15
        ),
        'M3 v2 coalesced market-batch kill switch & probe result')
ON CONFLICT (key) DO NOTHING;
