-- ============================================================
-- 1. checkup_knowledge_items: 新增回測相關欄位
-- ============================================================
ALTER TABLE public.checkup_knowledge_items
  ADD COLUMN IF NOT EXISTS backtestable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES public.checkup_knowledge_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backtest_stats jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS backtest_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS universe_size integer;

CREATE INDEX IF NOT EXISTS idx_knowledge_items_backtestable
  ON public.checkup_knowledge_items(backtestable) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_knowledge_items_parent
  ON public.checkup_knowledge_items(parent_item_id);

-- ============================================================
-- 2. daily_price_snapshots: 新增 OHLC + 5日均量欄位
-- ============================================================
ALTER TABLE public.daily_price_snapshots
  ADD COLUMN IF NOT EXISTS open_price numeric,
  ADD COLUMN IF NOT EXISTS high_price numeric,
  ADD COLUMN IF NOT EXISTS low_price numeric,
  ADD COLUMN IF NOT EXISTS volume_ma5 numeric;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_symbol_date
  ON public.daily_price_snapshots(symbol, trade_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_date
  ON public.daily_price_snapshots(trade_date);

-- ============================================================
-- 3. knowledge_backtest_runs: 每次回測的批次紀錄
-- ============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id uuid REFERENCES public.checkup_knowledge_items(id) ON DELETE CASCADE,
  run_mode text NOT NULL DEFAULT 'full',  -- 'full' | 'grid_search' | 'cron_weekly'
  date_range_start date,
  date_range_end date,
  universe_size integer,
  total_hits integer NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  loss_count integer NOT NULL DEFAULT 0,
  win_rate numeric,
  avg_return_pct numeric,
  median_return_pct numeric,
  max_drawdown numeric,
  parameters jsonb DEFAULT '{}'::jsonb,
  details jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed',  -- 'running' | 'completed' | 'failed'
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_item
  ON public.knowledge_backtest_runs(knowledge_item_id, created_at DESC);

ALTER TABLE public.knowledge_backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage backtest runs"
ON public.knowledge_backtest_runs
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'company_admin'))
WITH CHECK (has_role(auth.uid(), 'company_admin'));

-- ============================================================
-- 4. knowledge_grid_search_results: 參數網格搜尋每格結果
-- ============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_grid_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.knowledge_backtest_runs(id) ON DELETE CASCADE,
  knowledge_item_id uuid NOT NULL REFERENCES public.checkup_knowledge_items(id) ON DELETE CASCADE,
  parameters jsonb NOT NULL,
  total_hits integer NOT NULL DEFAULT 0,
  win_rate numeric,
  avg_return_pct numeric,
  score numeric,  -- composite ranking score
  is_best boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grid_results_run
  ON public.knowledge_grid_search_results(run_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_grid_results_item_best
  ON public.knowledge_grid_search_results(knowledge_item_id, is_best) WHERE is_best = true;

ALTER TABLE public.knowledge_grid_search_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage grid search"
ON public.knowledge_grid_search_results
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'company_admin'))
WITH CHECK (has_role(auth.uid(), 'company_admin'));

-- ============================================================
-- 5. 6 種標準 trigger schema 的驗證函式
--    支援的 type:
--      - foreign_buy_streak (外資連買)
--      - volume_price_surge (量價齊揚)
--      - ma_breakdown (跌破均線)
--      - kd_golden_cross (KD 黃金交叉)
--      - revenue_yoy (月營收 YoY)
--      - gap_up (跳空缺口)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_backtestable_trigger(_cond jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  t text;
BEGIN
  IF _cond IS NULL OR jsonb_typeof(_cond) <> 'object' THEN RETURN false; END IF;
  t := _cond->>'type';
  IF t IS NULL THEN RETURN false; END IF;

  IF t = 'foreign_buy_streak' THEN
    RETURN (_cond ? 'min_days')
       AND jsonb_typeof(_cond->'min_days') = 'number'
       AND (_cond->>'min_days')::int BETWEEN 1 AND 30
       AND ((_cond ? 'min_volume_pct') = false OR jsonb_typeof(_cond->'min_volume_pct') = 'number');

  ELSIF t = 'volume_price_surge' THEN
    RETURN jsonb_typeof(_cond->'min_volume_ratio') = 'number'
       AND jsonb_typeof(_cond->'min_price_change_pct') = 'number';

  ELSIF t = 'ma_breakdown' THEN
    RETURN jsonb_typeof(_cond->'ma_period') = 'number'
       AND (_cond->>'ma_period')::int IN (5,10,20,60,120,240)
       AND ((_cond ? 'direction') = false OR (_cond->>'direction') IN ('break_below','break_above'));

  ELSIF t = 'kd_golden_cross' THEN
    RETURN ((_cond ? 'k_period') = false OR jsonb_typeof(_cond->'k_period') = 'number')
       AND ((_cond ? 'oversold_threshold') = false OR jsonb_typeof(_cond->'oversold_threshold') = 'number');

  ELSIF t = 'revenue_yoy' THEN
    RETURN jsonb_typeof(_cond->'min_yoy_pct') = 'number';

  ELSIF t = 'gap_up' THEN
    RETURN jsonb_typeof(_cond->'min_gap_pct') = 'number';
  END IF;

  RETURN false;
END;
$$;

-- ============================================================
-- 6. trigger: 自動標記 backtestable
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_knowledge_backtestable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.backtestable := public.is_backtestable_trigger(NEW.trigger_condition);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_backtestable_items ON public.checkup_knowledge_items;
CREATE TRIGGER trg_set_backtestable_items
  BEFORE INSERT OR UPDATE OF trigger_condition ON public.checkup_knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.set_knowledge_backtestable();

-- 同步把現有資料的 backtestable 補上
UPDATE public.checkup_knowledge_items
SET backtestable = public.is_backtestable_trigger(trigger_condition)
WHERE trigger_condition IS NOT NULL;

-- ============================================================
-- 7. 版本歸檔 helper：把舊 item 標 archived，建立新版指回原 id
-- ============================================================
CREATE OR REPLACE FUNCTION public.archive_and_promote_knowledge(
  _old_id uuid,
  _new_trigger jsonb,
  _new_confidence numeric DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old record;
  _new_id uuid;
  _next_version int;
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO _old FROM public.checkup_knowledge_items WHERE id = _old_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge item not found: %', _old_id; END IF;

  _next_version := COALESCE(_old.version, 1) + 1;

  -- 歸檔舊版
  UPDATE public.checkup_knowledge_items
  SET is_active = false,
      archived_at = now()
  WHERE id = _old_id;

  -- 建立新版（指回原 item 為 parent）
  INSERT INTO public.checkup_knowledge_items (
    category, item_id, title, fact, interpretation, action,
    lessons, return_pct, outcome, tags,
    trigger_condition, expected_outcome, industry_tags, time_horizon,
    source_type, confidence, version, parent_item_id, is_active
  )
  SELECT
    category,
    item_id || '-v' || _next_version,
    title,
    fact,
    interpretation,
    action,
    lessons, return_pct, outcome, tags,
    _new_trigger,
    expected_outcome,
    industry_tags,
    time_horizon,
    'grid_search_optimized',
    COALESCE(_new_confidence, confidence),
    _next_version,
    _old_id,
    true
  FROM public.checkup_knowledge_items
  WHERE id = _old_id
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;