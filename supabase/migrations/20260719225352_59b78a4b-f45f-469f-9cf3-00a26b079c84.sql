
-- =========================================
-- PR-1: 台股籌碼面資料表骨架
-- =========================================

-- 1) 每日全市場三大法人（T86 落地）
CREATE TABLE public.tw_institutional_daily (
  id BIGSERIAL PRIMARY KEY,
  stock_id TEXT NOT NULL,
  trade_date DATE NOT NULL,
  foreign_net BIGINT NOT NULL DEFAULT 0,       -- 外資淨買賣（股）
  trust_net BIGINT NOT NULL DEFAULT 0,         -- 投信淨買賣（股）
  dealer_net BIGINT NOT NULL DEFAULT 0,        -- 自營商淨買賣（股）
  total_net BIGINT NOT NULL DEFAULT 0,         -- 三大法人合計
  raw JSONB,                                    -- 原始欄位保留
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, trade_date)
);
CREATE INDEX idx_tw_inst_stock_date ON public.tw_institutional_daily (stock_id, trade_date DESC);
CREATE INDEX idx_tw_inst_date ON public.tw_institutional_daily (trade_date DESC);

GRANT SELECT ON public.tw_institutional_daily TO authenticated;
GRANT ALL ON public.tw_institutional_daily TO service_role;

ALTER TABLE public.tw_institutional_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tw_inst_authenticated_read"
  ON public.tw_institutional_daily FOR SELECT
  TO authenticated
  USING (true);


-- 2) 每日個股分點券商買賣超
CREATE TABLE public.tw_bsr_daily (
  id BIGSERIAL PRIMARY KEY,
  stock_id TEXT NOT NULL,
  trade_date DATE NOT NULL,
  broker_id TEXT NOT NULL,             -- 券商代號（含分點，如 9800a1）
  broker_name TEXT NOT NULL,           -- 券商 · 分行
  buy_shares BIGINT NOT NULL DEFAULT 0,
  sell_shares BIGINT NOT NULL DEFAULT 0,
  net_shares BIGINT NOT NULL DEFAULT 0,
  avg_buy_price NUMERIC(12,4),
  avg_sell_price NUMERIC(12,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, trade_date, broker_id)
);
CREATE INDEX idx_tw_bsr_stock_date ON public.tw_bsr_daily (stock_id, trade_date DESC);
CREATE INDEX idx_tw_bsr_stock_date_net ON public.tw_bsr_daily (stock_id, trade_date DESC, net_shares);

GRANT SELECT ON public.tw_bsr_daily TO authenticated;
GRANT ALL ON public.tw_bsr_daily TO service_role;

ALTER TABLE public.tw_bsr_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tw_bsr_authenticated_read"
  ON public.tw_bsr_daily FOR SELECT
  TO authenticated
  USING (true);


-- 3) 預先算好的 rollup（1/5/20/60 日）
CREATE TABLE public.tw_chips_rollup (
  id BIGSERIAL PRIMARY KEY,
  stock_id TEXT NOT NULL,
  as_of_date DATE NOT NULL,
  window_days SMALLINT NOT NULL CHECK (window_days IN (1, 5, 20, 60)),
  foreign_net BIGINT NOT NULL DEFAULT 0,
  trust_net BIGINT NOT NULL DEFAULT 0,
  dealer_net BIGINT NOT NULL DEFAULT 0,
  top_buy_brokers JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{broker_id, name, net}]
  top_sell_brokers JSONB NOT NULL DEFAULT '[]'::jsonb,
  concentration_ratio NUMERIC(5,2),                     -- 前 15 大占比 (%)
  bsr_available BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, as_of_date, window_days)
);
CREATE INDEX idx_tw_rollup_lookup ON public.tw_chips_rollup (stock_id, as_of_date DESC, window_days);

GRANT SELECT ON public.tw_chips_rollup TO authenticated;
GRANT ALL ON public.tw_chips_rollup TO service_role;

ALTER TABLE public.tw_chips_rollup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tw_rollup_authenticated_read"
  ON public.tw_chips_rollup FOR SELECT
  TO authenticated
  USING (true);


-- 4) BSR 抓取失敗紀錄（隔日補跑）
CREATE TABLE public.tw_bsr_fetch_failures (
  id BIGSERIAL PRIMARY KEY,
  stock_id TEXT NOT NULL,
  trade_date DATE NOT NULL,
  reason TEXT NOT NULL,                 -- 'ocr_failed' | 'network' | 'parse' | 'captcha_retry_exhausted'
  attempts SMALLINT NOT NULL DEFAULT 1,
  last_error TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, trade_date)
);
CREATE INDEX idx_tw_bsr_fail_unresolved ON public.tw_bsr_fetch_failures (trade_date DESC) WHERE resolved_at IS NULL;

GRANT ALL ON public.tw_bsr_fetch_failures TO service_role;

ALTER TABLE public.tw_bsr_fetch_failures ENABLE ROW LEVEL SECURITY;

-- 只有 service_role 可存取；不放 authenticated policy


-- 5) updated_at 觸發器
CREATE OR REPLACE FUNCTION public.tw_chips_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tw_inst_updated
  BEFORE UPDATE ON public.tw_institutional_daily
  FOR EACH ROW EXECUTE FUNCTION public.tw_chips_touch_updated_at();

CREATE TRIGGER trg_tw_rollup_updated
  BEFORE UPDATE ON public.tw_chips_rollup
  FOR EACH ROW EXECUTE FUNCTION public.tw_chips_touch_updated_at();

CREATE TRIGGER trg_tw_bsr_fail_updated
  BEFORE UPDATE ON public.tw_bsr_fetch_failures
  FOR EACH ROW EXECUTE FUNCTION public.tw_chips_touch_updated_at();
