
-- ============================================================================
-- Phase 1: current_prices schema hardening + universe/freshness views + canonical writer
-- ============================================================================

-- 1. updated_at TEXT → TIMESTAMPTZ (backfill from existing text / pushed_at)
ALTER TABLE public.current_prices
  ADD COLUMN IF NOT EXISTS updated_at_ts timestamptz;

UPDATE public.current_prices
SET updated_at_ts = COALESCE(
  NULLIF(updated_at, '')::timestamptz,
  pushed_at,
  now()
)
WHERE updated_at_ts IS NULL;

ALTER TABLE public.current_prices DROP COLUMN updated_at;
ALTER TABLE public.current_prices RENAME COLUMN updated_at_ts TO updated_at;
ALTER TABLE public.current_prices
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

-- 2. writer 稽核欄
ALTER TABLE public.current_prices
  ADD COLUMN IF NOT EXISTS writer text;

-- 3. index for freshness scans
CREATE INDEX IF NOT EXISTS idx_current_prices_market_updated
  ON public.current_prices (market, updated_at DESC);

-- ============================================================================
-- 4. Universe view: 所有需要維持現價的 symbol
-- ============================================================================
CREATE OR REPLACE VIEW public.v_price_sync_universe AS
WITH raw_symbols AS (
  -- 開倉的交易紀錄
  SELECT TRIM(SPLIT_PART(instrument, ' ', 1)) AS symbol, 'trade_records'::text AS source
  FROM public.trade_records
  WHERE status = 'open' AND instrument IS NOT NULL

  UNION
  -- 近 180 天的老師 signals
  SELECT TRIM(SPLIT_PART(instrument, ' ', 1)) AS symbol, 'expert_signals'::text AS source
  FROM public.expert_signals
  WHERE instrument IS NOT NULL
    AND created_at >= now() - interval '180 days'

  UNION
  -- 加密貨幣 map
  SELECT UPPER(symbol) AS symbol, 'crypto_symbol_map'::text AS source
  FROM public.crypto_symbol_map
  WHERE is_active = true

  UNION
  -- Free Checkup 使用者持倉快照
  SELECT UPPER(TRIM(elem->>'code')) AS symbol, 'checkup_storage'::text AS source
  FROM public.checkup_storage,
       LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(data) = 'array' THEN data ELSE '[]'::jsonb END
       ) AS elem
  WHERE key = 'pf-holdings-v2'
    AND elem ? 'code'
),
classified AS (
  SELECT
    symbol,
    CASE
      WHEN symbol ~ '^[A-Z]{1,5}(\.[A-Z])?$' THEN 'US'
      WHEN symbol ~ '^\d{4}$' THEN 'TW'
      WHEN symbol ~ '^[03567]\d{5}$' THEN 'TW'   -- 權證
      WHEN symbol IN (SELECT UPPER(symbol) FROM public.crypto_symbol_map WHERE is_active=true) THEN 'CRYPTO'
      ELSE NULL
    END AS market,
    CASE
      WHEN symbol ~ '^[03567]\d{5}$' THEN 20  -- 權證優先度較低
      WHEN symbol ~ '^\d{4}$' THEN 10
      WHEN symbol ~ '^[A-Z]{1,5}$' THEN 10
      ELSE 30
    END AS priority
  FROM raw_symbols
  WHERE symbol IS NOT NULL AND symbol <> ''
)
SELECT DISTINCT symbol, market, priority
FROM classified
WHERE market IS NOT NULL;

GRANT SELECT ON public.v_price_sync_universe TO service_role, authenticated;

-- ============================================================================
-- 5. Freshness view
-- ============================================================================
CREATE OR REPLACE VIEW public.v_price_freshness AS
WITH universe AS (
  SELECT market, COUNT(*) AS universe_count
  FROM public.v_price_sync_universe
  GROUP BY market
),
prices AS (
  SELECT
    u.market,
    COUNT(cp.symbol) AS covered_count,
    (percentile_disc(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - cp.updated_at))::int))::int AS p50_age_s,
    (percentile_disc(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - cp.updated_at))::int))::int AS p95_age_s,
    MAX(EXTRACT(EPOCH FROM (now() - cp.updated_at)))::int AS max_age_s,
    MIN(cp.updated_at) AS oldest_updated_at,
    MAX(cp.updated_at) AS newest_updated_at
  FROM public.v_price_sync_universe u
  LEFT JOIN public.current_prices cp
    ON cp.symbol = u.symbol AND cp.market = u.market
  GROUP BY u.market
)
SELECT
  u.market,
  u.universe_count,
  COALESCE(p.covered_count, 0) AS covered_count,
  ROUND(COALESCE(p.covered_count, 0)::numeric / NULLIF(u.universe_count, 0), 4) AS coverage_ratio,
  p.p50_age_s,
  p.p95_age_s,
  p.max_age_s,
  p.oldest_updated_at,
  p.newest_updated_at
FROM universe u
LEFT JOIN prices p USING (market);

GRANT SELECT ON public.v_price_freshness TO service_role, authenticated;

-- ============================================================================
-- 6. Canonical writer RPC — 舊值不得覆蓋新值
-- ============================================================================
CREATE OR REPLACE FUNCTION public.upsert_current_price(
  p_writer text,
  p_rows   jsonb          -- 一次多筆 [{symbol, price, market, currency, asset_class, ...}]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_written integer := 0;
BEGIN
  WITH incoming AS (
    SELECT
      (r->>'symbol')::text          AS symbol,
      (r->>'name')::text            AS name,
      (r->>'price')::numeric        AS price,
      (r->>'change_value')::numeric AS change_value,
      (r->>'change_percent')::numeric AS change_percent,
      (r->>'yesterday_close')::numeric AS yesterday_close,
      (r->>'open_price')::numeric   AS open_price,
      (r->>'high_price')::numeric   AS high_price,
      (r->>'low_price')::numeric    AS low_price,
      (r->>'limit_up')::numeric     AS limit_up,
      (r->>'limit_down')::numeric   AS limit_down,
      NULLIF(r->>'volume','')::integer AS volume,
      NULLIF(r->>'tick_volume','')::integer AS tick_volume,
      (r->>'best_bid')::numeric     AS best_bid,
      (r->>'best_ask')::numeric     AS best_ask,
      COALESCE((r->>'currency')::text, 'TWD') AS currency,
      COALESCE((r->>'market')::text, 'TW')    AS market,
      COALESCE((r->>'asset_class')::text, 'tw_stock') AS asset_class,
      COALESCE(NULLIF(r->>'updated_at','')::timestamptz, now()) AS updated_at
    FROM jsonb_array_elements(p_rows) r
    WHERE (r->>'symbol') IS NOT NULL AND (r->>'price')::numeric > 0
  ),
  ins AS (
    INSERT INTO public.current_prices (
      symbol, name, price, change_value, change_percent, yesterday_close,
      open_price, high_price, low_price, limit_up, limit_down,
      volume, tick_volume, best_bid, best_ask,
      currency, market, asset_class, updated_at, pushed_at, writer
    )
    SELECT
      i.symbol, i.name, i.price, i.change_value, i.change_percent, i.yesterday_close,
      i.open_price, i.high_price, i.low_price, i.limit_up, i.limit_down,
      i.volume, i.tick_volume, i.best_bid, i.best_ask,
      i.currency, i.market, i.asset_class, i.updated_at, now(), p_writer
    FROM incoming i
    ON CONFLICT (symbol) DO UPDATE
      SET name           = COALESCE(EXCLUDED.name, current_prices.name),
          price          = EXCLUDED.price,
          change_value   = COALESCE(EXCLUDED.change_value, current_prices.change_value),
          change_percent = COALESCE(EXCLUDED.change_percent, current_prices.change_percent),
          yesterday_close= COALESCE(EXCLUDED.yesterday_close, current_prices.yesterday_close),
          open_price     = COALESCE(EXCLUDED.open_price, current_prices.open_price),
          high_price     = COALESCE(EXCLUDED.high_price, current_prices.high_price),
          low_price      = COALESCE(EXCLUDED.low_price, current_prices.low_price),
          limit_up       = COALESCE(EXCLUDED.limit_up, current_prices.limit_up),
          limit_down     = COALESCE(EXCLUDED.limit_down, current_prices.limit_down),
          volume         = COALESCE(EXCLUDED.volume, current_prices.volume),
          tick_volume    = COALESCE(EXCLUDED.tick_volume, current_prices.tick_volume),
          best_bid       = COALESCE(EXCLUDED.best_bid, current_prices.best_bid),
          best_ask       = COALESCE(EXCLUDED.best_ask, current_prices.best_ask),
          currency       = EXCLUDED.currency,
          market         = EXCLUDED.market,
          asset_class    = EXCLUDED.asset_class,
          updated_at     = EXCLUDED.updated_at,
          pushed_at      = now(),
          writer         = EXCLUDED.writer
      WHERE EXCLUDED.updated_at > current_prices.updated_at
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_written FROM ins;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_current_price(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_current_price(text, jsonb) TO service_role;

-- ============================================================================
-- 7. Price quota pools (仿 finmind_admit_v2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.price_quota_pools (
  market       text PRIMARY KEY,
  api_name     text NOT NULL,
  per_min_cap  integer NOT NULL,
  per_day_cap  integer,
  tokens       double precision NOT NULL DEFAULT 0,
  last_refill  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.price_quota_pools TO authenticated;
GRANT ALL ON public.price_quota_pools TO service_role;
ALTER TABLE public.price_quota_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quota pools admin read" ON public.price_quota_pools
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));

INSERT INTO public.price_quota_pools (market, api_name, per_min_cap, per_day_cap, tokens) VALUES
  ('TW',     'twse_mis',   60,   NULL, 60),
  ('US',     'finnhub',    55,   NULL, 55),   -- 免費方案 60/min，留 5 buffer
  ('CRYPTO', 'binance',   1000,  NULL, 1000)
ON CONFLICT (market) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.price_quota_ledger (
  id           bigserial PRIMARY KEY,
  market       text NOT NULL,
  requested    integer NOT NULL,
  admitted     integer NOT NULL,
  tokens_after double precision NOT NULL,
  writer       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.price_quota_ledger TO authenticated;
GRANT ALL ON public.price_quota_ledger TO service_role;
ALTER TABLE public.price_quota_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quota ledger admin read" ON public.price_quota_ledger
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));
CREATE INDEX IF NOT EXISTS idx_price_quota_ledger_market_time
  ON public.price_quota_ledger (market, created_at DESC);

-- Token bucket admit
CREATE OR REPLACE FUNCTION public.price_admit(
  p_market    text,
  p_requested integer,
  p_writer    text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool         public.price_quota_pools%ROWTYPE;
  v_now          timestamptz := now();
  v_elapsed_s    double precision;
  v_refill_rate  double precision;
  v_new_tokens   double precision;
  v_admit        integer;
BEGIN
  SELECT * INTO v_pool FROM public.price_quota_pools WHERE market = p_market FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_elapsed_s := EXTRACT(EPOCH FROM (v_now - v_pool.last_refill));
  v_refill_rate := v_pool.per_min_cap::double precision / 60.0;  -- tokens per second
  v_new_tokens := LEAST(v_pool.per_min_cap::double precision,
                        v_pool.tokens + v_elapsed_s * v_refill_rate);

  v_admit := LEAST(p_requested, FLOOR(v_new_tokens)::integer);
  IF v_admit < 0 THEN v_admit := 0; END IF;

  UPDATE public.price_quota_pools
    SET tokens = v_new_tokens - v_admit,
        last_refill = v_now,
        updated_at = v_now
    WHERE market = p_market;

  INSERT INTO public.price_quota_ledger (market, requested, admitted, tokens_after, writer)
    VALUES (p_market, p_requested, v_admit, v_new_tokens - v_admit, p_writer);

  RETURN v_admit;
END;
$$;

REVOKE ALL ON FUNCTION public.price_admit(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.price_admit(text, integer, text) TO service_role;
