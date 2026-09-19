-- VALUATION_THREE_RULERS_PLAN_V1 · S1 資料層
-- 狀態：**僅產出檔案，尚未套用到正式 DB**（依計畫，fresh Hosted Preview 通過前不得套用）。
-- 套用方式：核准後以 migration 工具原樣執行。

-- 1) 逐日估值序列（交易所公告口徑：TTM EPS / 最新 BVPS / 近 12 月現金股利）
CREATE TABLE IF NOT EXISTS public.tw_valuation_daily (
  id             bigserial PRIMARY KEY,
  symbol         text        NOT NULL,
  trade_date     date        NOT NULL,
  per            numeric,          -- NULL = 近四季無獲利（不得填 0）
  pbr            numeric,
  dividend_yield numeric,          -- 百分比數值，3.29 表示 3.29%
  market         text,             -- 'TWSE' | 'TPEX'
  source         text        NOT NULL DEFAULT 'finmind',
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tw_valuation_daily_symbol_not_blank CHECK (btrim(symbol) <> ''),
  CONSTRAINT tw_valuation_daily_per_positive CHECK (per IS NULL OR per > 0),
  CONSTRAINT tw_valuation_daily_pbr_positive CHECK (pbr IS NULL OR pbr > 0),
  CONSTRAINT tw_valuation_daily_yield_nonneg CHECK (dividend_yield IS NULL OR dividend_yield >= 0),
  CONSTRAINT tw_valuation_daily_uniq UNIQUE (symbol, trade_date)
);

GRANT SELECT ON public.tw_valuation_daily TO anon;
GRANT SELECT ON public.tw_valuation_daily TO authenticated;
GRANT ALL    ON public.tw_valuation_daily TO service_role;

ALTER TABLE public.tw_valuation_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tw_valuation_daily_public_read ON public.tw_valuation_daily;
CREATE POLICY tw_valuation_daily_public_read
  ON public.tw_valuation_daily FOR SELECT
  USING (true);   -- 市場公開資料，無 tenant 欄位，故不存在跨 tenant 外洩面

DROP POLICY IF EXISTS tw_valuation_daily_service_all ON public.tw_valuation_daily;
CREATE POLICY tw_valuation_daily_service_all
  ON public.tw_valuation_daily FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tw_valuation_daily_symbol_date
  ON public.tw_valuation_daily (symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_tw_valuation_daily_date
  ON public.tw_valuation_daily (trade_date DESC);

COMMENT ON TABLE public.tw_valuation_daily IS
  '估值三把尺逐日序列（PER/PBR/現金殖利率），主來源 FinMind TaiwanStockPER，TWSE BWIBBU_ALL 對帳。';

-- 2) 同業名單（產業分類來自前台 stockMetaMulti 的同一份 TWSE/FinMind 產業表，
--    由 script 匯入，不得在前端硬編公司）
CREATE TABLE IF NOT EXISTS public.tw_industry_peers (
  symbol     text PRIMARY KEY,
  industry   text NOT NULL,
  market     text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tw_industry_peers TO anon;
GRANT SELECT ON public.tw_industry_peers TO authenticated;
GRANT ALL    ON public.tw_industry_peers TO service_role;

ALTER TABLE public.tw_industry_peers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tw_industry_peers_public_read ON public.tw_industry_peers;
CREATE POLICY tw_industry_peers_public_read
  ON public.tw_industry_peers FOR SELECT USING (true);

DROP POLICY IF EXISTS tw_industry_peers_service_all ON public.tw_industry_peers;
CREATE POLICY tw_industry_peers_service_all
  ON public.tw_industry_peers FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tw_industry_peers_industry
  ON public.tw_industry_peers (industry, market);

-- 3) 一次取回：目前值 + 近 5 年逐日序列 + 同業列（分位/中位數/溢折價一律在前端
--    canonical 純函式 valuationRulers.ts 計算，避免兩份公式漂移）
CREATE OR REPLACE FUNCTION public.valuation_snapshot(_symbol text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sym AS (
    SELECT btrim(_symbol) AS s
  ),
  latest AS (
    SELECT v.*
    FROM public.tw_valuation_daily v, sym
    WHERE v.symbol = sym.s
    ORDER BY v.trade_date DESC
    LIMIT 1
  ),
  hist AS (
    SELECT v.per, v.pbr, v.dividend_yield
    FROM public.tw_valuation_daily v, sym
    WHERE v.symbol = sym.s
      AND v.trade_date >= (CURRENT_DATE - INTERVAL '5 years')
  ),
  ind AS (
    SELECT p.industry, p.market FROM public.tw_industry_peers p, sym WHERE p.symbol = sym.s
  ),
  peers AS (
    SELECT p.symbol, n.name, lv.per, lv.pbr, lv.dividend_yield
    FROM public.tw_industry_peers p
    JOIN ind ON ind.industry = p.industry
             AND (ind.market IS NULL OR p.market IS NULL OR p.market = ind.market)
    LEFT JOIN public.stock_names n ON n.symbol = p.symbol
    JOIN LATERAL (
      SELECT v.per, v.pbr, v.dividend_yield
      FROM public.tw_valuation_daily v
      WHERE v.symbol = p.symbol
      ORDER BY v.trade_date DESC
      LIMIT 1
    ) lv ON true, sym
    WHERE p.symbol <> sym.s
  )
  SELECT jsonb_build_object(
    'symbol', (SELECT s FROM sym),
    'asOf', (SELECT to_char(trade_date, 'YYYY-MM-DD') FROM latest),
    'source', (SELECT source FROM latest),
    'pe', (SELECT per FROM latest),
    'pb', (SELECT pbr FROM latest),
    'dividendYield', (SELECT dividend_yield FROM latest),
    'industry', (SELECT industry FROM ind),
    'history', jsonb_build_object(
      'pe', COALESCE((SELECT jsonb_agg(per) FROM hist WHERE per IS NOT NULL), '[]'::jsonb),
      'pb', COALESCE((SELECT jsonb_agg(pbr) FROM hist WHERE pbr IS NOT NULL), '[]'::jsonb),
      'dividendYield', COALESCE((SELECT jsonb_agg(dividend_yield) FROM hist WHERE dividend_yield IS NOT NULL), '[]'::jsonb)
    ),
    'peers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'symbol', symbol, 'name', name,
        'pe', per, 'pb', pbr, 'dividendYield', dividend_yield))
      FROM peers
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.valuation_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valuation_snapshot(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.valuation_snapshot(text) TO service_role;
