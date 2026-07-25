
-- 1. Extend finmind_quota_pools with token-bucket columns
ALTER TABLE public.finmind_quota_pools
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS tokens numeric,
  ADD COLUMN IF NOT EXISTS refill_per_min numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_refill_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS borrow_enabled boolean NOT NULL DEFAULT true;

UPDATE public.finmind_quota_pools
  SET capacity = COALESCE(capacity, daily_budget),
      tokens   = COALESCE(tokens, daily_budget::numeric);

-- Sensible defaults: refill per minute so we spread daily_budget over trading hours
UPDATE public.finmind_quota_pools
  SET refill_per_min = GREATEST(1, ROUND(daily_budget::numeric / 480, 2))
  WHERE refill_per_min = 0;

-- 2. Upstream quota tracking (from FinMind response headers when available)
CREATE TABLE IF NOT EXISTS public.finmind_upstream_quota (
  source text PRIMARY KEY,
  remaining integer,
  quota_limit integer,
  reset_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb
);

GRANT SELECT ON public.finmind_upstream_quota TO authenticated;
GRANT ALL ON public.finmind_upstream_quota TO service_role;
ALTER TABLE public.finmind_upstream_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read finmind upstream quota" ON public.finmind_upstream_quota;
CREATE POLICY "admin read finmind upstream quota"
  ON public.finmind_upstream_quota FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::public.app_role));

DROP POLICY IF EXISTS "service write finmind upstream quota" ON public.finmind_upstream_quota;
CREATE POLICY "service write finmind upstream quota"
  ON public.finmind_upstream_quota FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 3. Token-bucket admission RPC (v2), with priority borrowing for interactive pool
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
  now_ts timestamptz := now();
  today_tw date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  minutes numeric;
  borrow_pool text;
  bp record;
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

  -- Daily budget cap first
  IF p.used_today + _cost > p.daily_budget THEN
    -- Try borrow (only from lower-priority pools; hard-code interactive > keepwarm > backfill)
    IF _allow_borrow AND COALESCE(p.borrow_enabled, true) AND _pool = 'interactive' THEN
      FOREACH borrow_pool IN ARRAY ARRAY['keepwarm','backfill'] LOOP
        SELECT * INTO bp FROM public.finmind_quota_pools WHERE pool_name = borrow_pool FOR UPDATE;
        IF FOUND
           AND bp.used_today + _cost <= bp.daily_budget
           AND COALESCE(bp.tokens, 0) >= _cost THEN
          UPDATE public.finmind_quota_pools
            SET used_today = used_today + _cost::int,
                tokens = tokens - _cost,
                updated_at = now_ts
            WHERE pool_name = borrow_pool;
          INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason)
            VALUES (_pool, _kind, _stock_id, true, 'borrowed_from:' || borrow_pool);
          RETURN jsonb_build_object(
            'granted', true, 'reason', 'borrowed',
            'borrowed_from', borrow_pool,
            'remaining', GREATEST(0, bp.daily_budget - bp.used_today - _cost::int)
          );
        END IF;
      END LOOP;
    END IF;

    UPDATE public.finmind_quota_pools
      SET last_reject_at = now_ts, last_reject_reason = 'daily_exhausted'
      WHERE pool_name = _pool;
    INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason)
      VALUES (_pool, _kind, _stock_id, false, 'daily_exhausted');
    RETURN jsonb_build_object('granted', false, 'reason', 'daily_exhausted');
  END IF;

  -- Token bucket rate cap
  IF COALESCE(p.tokens, p.daily_budget::numeric) < _cost THEN
    UPDATE public.finmind_quota_pools
      SET last_reject_at = now_ts, last_reject_reason = 'rate_limited'
      WHERE pool_name = _pool;
    INSERT INTO public.finmind_quota_ledger(pool_name, request_kind, stock_id, granted, reason)
      VALUES (_pool, _kind, _stock_id, false, 'rate_limited');
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
    'remaining', GREATEST(0, (p.daily_budget - p.used_today - _cost::int))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finmind_admit_v2(text, text, text, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finmind_admit_v2(text, text, text, numeric, boolean) TO service_role;
