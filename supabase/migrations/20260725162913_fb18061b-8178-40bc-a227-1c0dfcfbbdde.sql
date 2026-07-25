
-- 1. Ledger 補欄位
ALTER TABLE public.finmind_quota_ledger
  ADD COLUMN IF NOT EXISTS borrowed_from text,
  ADD COLUMN IF NOT EXISTS root_cause_hint text;

CREATE INDEX IF NOT EXISTS idx_finmind_quota_ledger_pool_time
  ON public.finmind_quota_ledger(pool_name, created_at DESC);

-- 2. data_source_health 上游配額欄位
ALTER TABLE public.data_source_health
  ADD COLUMN IF NOT EXISTS upstream_quota_remaining integer,
  ADD COLUMN IF NOT EXISTS upstream_quota_limit integer,
  ADD COLUMN IF NOT EXISTS upstream_quota_reset_at timestamptz;

-- 3. finmind_quota_pools：SLO boost + manual override
ALTER TABLE public.finmind_quota_pools
  ADD COLUMN IF NOT EXISTS slo_boost_until timestamptz,
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_daily_budget integer;

UPDATE public.finmind_quota_pools
  SET base_daily_budget = COALESCE(base_daily_budget, daily_budget);

-- 4. finmind_inflight_requests（跨 isolate 合流）
CREATE TABLE IF NOT EXISTS public.finmind_inflight_requests (
  key text PRIMARY KEY,
  stock_id text,
  kind text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 seconds'
);

GRANT SELECT ON public.finmind_inflight_requests TO authenticated;
GRANT ALL ON public.finmind_inflight_requests TO service_role;
ALTER TABLE public.finmind_inflight_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read inflight" ON public.finmind_inflight_requests;
CREATE POLICY "admin read inflight"
  ON public.finmind_inflight_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::public.app_role));

DROP POLICY IF EXISTS "service write inflight" ON public.finmind_inflight_requests;
CREATE POLICY "service write inflight"
  ON public.finmind_inflight_requests FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 5. 舊 daily 過渡視圖
CREATE OR REPLACE VIEW public.finmind_pool_daily_equiv AS
SELECT
  pool_name,
  daily_budget,
  used_today,
  GREATEST(0, daily_budget - used_today) AS remaining_today,
  tokens,
  capacity,
  refill_per_min,
  ROUND((refill_per_min * 60)::numeric, 2) AS refill_per_hour,
  CASE WHEN refill_per_min > 0
       THEN NOW() + make_interval(mins => (tokens / refill_per_min)::int)
       ELSE NULL END AS estimated_full_at,
  slo_boost_until,
  manual_override
FROM public.finmind_quota_pools;

GRANT SELECT ON public.finmind_pool_daily_equiv TO authenticated;

-- 6. chips_state_hourly 視圖：以 ledger granted/rejected 聚合
CREATE OR REPLACE VIEW public.chips_state_hourly AS
SELECT
  date_trunc('hour', created_at) AS hour,
  pool_name,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE granted)::int AS granted,
  COUNT(*) FILTER (WHERE NOT granted)::int AS rejected,
  ROUND(
    (COUNT(*) FILTER (WHERE granted))::numeric / NULLIF(COUNT(*), 0),
  4) AS ready_ratio,
  COUNT(*) FILTER (WHERE borrowed_from IS NOT NULL)::int AS borrowed
FROM public.finmind_quota_ledger
WHERE created_at > now() - interval '48 hours'
GROUP BY 1, 2;

GRANT SELECT ON public.chips_state_hourly TO authenticated;

-- 7. 覆寫 finmind_admit_v2：只從 keepwarm 借、keepwarm ≥30% 才借、ledger 寫 borrowed_from/root_cause_hint
CREATE OR REPLACE FUNCTION public.finmind_admit_v2(
  _pool text,
  _kind text,
  _stock_id text DEFAULT NULL,
  _cost numeric DEFAULT 1,
  _allow_borrow boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  bp record;
  now_ts timestamptz := now();
  today_tw date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  minutes numeric;
  keepwarm_reserve numeric;
BEGIN
  SELECT * INTO p FROM public.finmind_quota_pools WHERE pool_name = _pool FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'pool_not_found');
  END IF;

  -- Daily reset
  IF p.reset_at < today_tw THEN
    UPDATE public.finmind_quota_pools
      SET used_today = 0,
          tokens = COALESCE(capacity, daily_budget)::numeric,
          reset_at = today_tw,
          last_refill_at = now_ts
      WHERE pool_name = _pool
      RETURNING * INTO p;
  END IF;

  -- Token refill
  minutes := GREATEST(0, EXTRACT(EPOCH FROM (now_ts - p.last_refill_at)) / 60.0);
  IF minutes > 0 AND COALESCE(p.refill_per_min, 0) > 0 THEN
    UPDATE public.finmind_quota_pools
      SET tokens = LEAST(COALESCE(capacity, daily_budget)::numeric,
                         COALESCE(tokens, 0) + minutes * refill_per_min),
          last_refill_at = now_ts
      WHERE pool_name = _pool
      RETURNING * INTO p;
  END IF;

  -- Daily budget cap
  IF p.used_today + _cost > p.daily_budget THEN
    -- 借用：只允許 interactive → keepwarm，且 keepwarm.tokens ≥ 30% capacity
    IF _allow_borrow AND COALESCE(p.borrow_enabled, true) AND _pool = 'interactive' THEN
      SELECT * INTO bp FROM public.finmind_quota_pools WHERE pool_name = 'keepwarm' FOR UPDATE;
      IF FOUND AND COALESCE(bp.borrow_enabled, true) THEN
        keepwarm_reserve := COALESCE(bp.capacity, bp.daily_budget)::numeric * 0.3;
        IF bp.used_today + _cost <= bp.daily_budget
           AND COALESCE(bp.tokens, 0) - _cost >= keepwarm_reserve THEN
          UPDATE public.finmind_quota_pools
            SET used_today = used_today + _cost::int,
                tokens = tokens - _cost,
                updated_at = now_ts
            WHERE pool_name = 'keepwarm';
          INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason, borrowed_from, root_cause_hint)
            VALUES (_pool, _kind, _stock_id, true, 'borrowed', 'keepwarm',
                    'interactive_exhausted_borrow_from_keepwarm');
          RETURN jsonb_build_object(
            'granted', true, 'reason', 'borrowed',
            'borrowed_from', 'keepwarm',
            'remaining', GREATEST(0, bp.daily_budget - bp.used_today - _cost::int)
          );
        END IF;
      END IF;
    END IF;

    UPDATE public.finmind_quota_pools
      SET last_reject_at = now_ts, last_reject_reason = 'daily_exhausted'
      WHERE pool_name = _pool;
    INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason, root_cause_hint)
      VALUES (_pool, _kind, _stock_id, false, 'daily_exhausted',
              CASE WHEN _pool = 'interactive' THEN 'interactive_daily_cap_no_borrow_room'
                   ELSE _pool || '_daily_cap' END);
    RETURN jsonb_build_object('granted', false, 'reason', 'daily_exhausted');
  END IF;

  -- Token bucket rate cap
  IF COALESCE(p.tokens, p.daily_budget::numeric) < _cost THEN
    UPDATE public.finmind_quota_pools
      SET last_reject_at = now_ts, last_reject_reason = 'rate_limited'
      WHERE pool_name = _pool;
    INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason, root_cause_hint)
      VALUES (_pool, _kind, _stock_id, false, 'rate_limited', _pool || '_bucket_empty');
    RETURN jsonb_build_object(
      'granted', false, 'reason', 'rate_limited',
      'reset_at', to_char(now_ts + make_interval(secs => CEIL(60.0 / GREATEST(p.refill_per_min, 0.1))), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    );
  END IF;

  UPDATE public.finmind_quota_pools
    SET used_today = used_today + _cost::int,
        tokens = tokens - _cost,
        updated_at = now_ts
    WHERE pool_name = _pool;

  INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason)
    VALUES (_pool, _kind, _stock_id, true, 'ok');

  RETURN jsonb_build_object(
    'granted', true, 'reason', 'ok',
    'remaining', GREATEST(0, (p.daily_budget - p.used_today - _cost::int)),
    'tokens_left', p.tokens - _cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finmind_admit_v2(text, text, text, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finmind_admit_v2(text, text, text, numeric, boolean) TO service_role;

-- 8. Inflight helper：acquire/release with automatic 30s expiry
CREATE OR REPLACE FUNCTION public.finmind_inflight_acquire(
  _key text, _stock_id text, _kind text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted boolean := false;
BEGIN
  -- GC expired first
  DELETE FROM public.finmind_inflight_requests WHERE expires_at < now();

  INSERT INTO public.finmind_inflight_requests(key, stock_id, kind)
    VALUES (_key, _stock_id, _kind)
    ON CONFLICT (key) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.finmind_inflight_release(_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.finmind_inflight_requests WHERE key = _key;
$$;

REVOKE ALL ON FUNCTION public.finmind_inflight_acquire(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finmind_inflight_release(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finmind_inflight_acquire(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finmind_inflight_release(text) TO service_role;
