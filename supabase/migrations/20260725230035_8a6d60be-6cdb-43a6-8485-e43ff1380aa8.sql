
-- ============================================================
-- P1｜Snapshot-First 全市場籌碼資料庫基座
-- ============================================================

-- 1) 事實層：所有 Lane 的原始分點資料 append-only 進這裡
CREATE TABLE IF NOT EXISTS public.tw_chip_fact (
  id            BIGSERIAL PRIMARY KEY,
  stock_id      TEXT NOT NULL,
  trade_date    DATE NOT NULL,
  broker_id     TEXT NOT NULL,
  broker_name   TEXT,
  source        TEXT NOT NULL,           -- finmind_batch / finmind_per_stock / broker_scrape_xxx / manual
  buy_shares    BIGINT NOT NULL DEFAULT 0,
  sell_shares   BIGINT NOT NULL DEFAULT 0,
  net_shares    BIGINT GENERATED ALWAYS AS (buy_shares - sell_shares) STORED,
  avg_buy_price NUMERIC(12,4),
  avg_sell_price NUMERIC(12,4),
  raw           JSONB,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tw_chip_fact_unique_lane UNIQUE (stock_id, trade_date, broker_id, source)
);

CREATE INDEX IF NOT EXISTS idx_tw_chip_fact_lookup
  ON public.tw_chip_fact (stock_id, trade_date DESC, source);
CREATE INDEX IF NOT EXISTS idx_tw_chip_fact_date
  ON public.tw_chip_fact (trade_date DESC);

GRANT SELECT ON public.tw_chip_fact TO authenticated;
GRANT ALL    ON public.tw_chip_fact TO service_role;

ALTER TABLE public.tw_chip_fact ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tw_chip_fact_admin_read"
  ON public.tw_chip_fact FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'company_admin'::app_role));

-- 2) snapshot_status 加欄位：seal 與 Lane 狀態
ALTER TABLE public.tw_bsr_daily_snapshot_status
  ADD COLUMN IF NOT EXISTS sealed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sealed_by_lane   TEXT,
  ADD COLUMN IF NOT EXISTS coverage_brokers INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lane_a_status    TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS lane_b_status    TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS lane_c_status    TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS partial_lanes    TEXT[] NOT NULL DEFAULT '{}';

-- 擴充 source 允許值（加入新 Lane 標籤）
ALTER TABLE public.tw_bsr_daily_snapshot_status
  DROP CONSTRAINT IF EXISTS tw_bsr_daily_snapshot_status_source_check;

ALTER TABLE public.tw_bsr_daily_snapshot_status
  ADD CONSTRAINT tw_bsr_daily_snapshot_status_source_check
  CHECK (source IS NULL OR source IN (
    'finmind_market_batch',
    'finmind_per_stock',
    'twse_official',
    'tpex_official',
    'broker_scrape',
    'reconciled',
    'manual'
  ));

CREATE INDEX IF NOT EXISTS idx_snapshot_status_sealed
  ON public.tw_bsr_daily_snapshot_status (sealed_at DESC NULLS LAST);

-- 3) helper：某日是否 sealed
CREATE OR REPLACE FUNCTION public.is_snapshot_sealed(_trade_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT sealed_at IS NOT NULL
       FROM public.tw_bsr_daily_snapshot_status
      WHERE trade_date = _trade_date),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_snapshot_sealed(DATE) TO authenticated, service_role;

-- 4) Immutability trigger：sealed 日期禁止改動 canonical 表
CREATE OR REPLACE FUNCTION public.enforce_snapshot_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  force_flag TEXT;
  target_date DATE;
BEGIN
  target_date := COALESCE(NEW.trade_date, OLD.trade_date);

  IF NOT public.is_snapshot_sealed(target_date) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- session-level bypass for admin force_reseal
  BEGIN
    force_flag := current_setting('app.force_reseal', true);
  EXCEPTION WHEN OTHERS THEN
    force_flag := NULL;
  END;

  IF force_flag = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'snapshot_sealed: %(row) on % is sealed; set app.force_reseal=true to override',
    TG_TABLE_NAME, target_date
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_tw_bsr_daily_immutable ON public.tw_bsr_daily;
CREATE TRIGGER trg_tw_bsr_daily_immutable
  BEFORE UPDATE OR DELETE ON public.tw_bsr_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_snapshot_immutability();

DROP TRIGGER IF EXISTS trg_tw_inst_daily_immutable ON public.tw_institutional_daily;
CREATE TRIGGER trg_tw_inst_daily_immutable
  BEFORE UPDATE OR DELETE ON public.tw_institutional_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_snapshot_immutability();

-- 5) 回填：把 snapshot_status 已 ready 的日期一次性打上 sealed_at，避免立刻鎖住合法寫入
UPDATE public.tw_bsr_daily_snapshot_status
   SET sealed_at = COALESCE(sealed_at, fetched_at, updated_at),
       sealed_by_lane = COALESCE(sealed_by_lane,
         CASE source
           WHEN 'finmind_market_batch' THEN 'A'
           WHEN 'finmind_per_stock'    THEN 'A'
           ELSE 'legacy'
         END),
       coverage_brokers = COALESCE(NULLIF(coverage_brokers, 0), coverage_rows)
 WHERE status = 'ready'
   AND sealed_at IS NULL;

COMMENT ON TABLE  public.tw_chip_fact IS 'P1: 三 Lane 分點原始資料事實層，append-only，仲裁器唯一 SoT';
COMMENT ON COLUMN public.tw_bsr_daily_snapshot_status.sealed_at IS 'P1: 一旦有值，canonical 表禁止改動（除非 app.force_reseal=true）';
COMMENT ON COLUMN public.tw_bsr_daily_snapshot_status.sealed_by_lane IS 'P1: A=FinMind, B=TWSE, C=TPEx, D=T86, E=Broker, reconciled=多源仲裁';
