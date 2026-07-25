
-- PR-0: 契約表、feature flag、觀測骨架

CREATE TABLE IF NOT EXISTS public.data_source_health (
  source TEXT PRIMARY KEY,
  ok_count_10m INT NOT NULL DEFAULT 0,
  fail_count_10m INT NOT NULL DEFAULT 0,
  p95_latency_ms INT,
  consecutive_failures INT NOT NULL DEFAULT 0,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  disabled_until TIMESTAMPTZ,
  last_error_code TEXT,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.data_source_health TO authenticated;
GRANT ALL ON public.data_source_health TO service_role;
ALTER TABLE public.data_source_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read data_source_health" ON public.data_source_health;
CREATE POLICY "admins read data_source_health"
  ON public.data_source_health FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

INSERT INTO public.data_source_health (source) VALUES
  ('finmind'), ('twse_bulk'), ('tpex_bulk'), ('twse_t86')
ON CONFLICT (source) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.institutional_new_stock_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id TEXT NOT NULL UNIQUE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','dead')),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inst_new_stock_queue_status_next
  ON public.institutional_new_stock_queue (status, next_attempt_at)
  WHERE status IN ('pending','running');
GRANT SELECT ON public.institutional_new_stock_queue TO authenticated;
GRANT ALL ON public.institutional_new_stock_queue TO service_role;
ALTER TABLE public.institutional_new_stock_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read inst_new_stock_queue" ON public.institutional_new_stock_queue;
CREATE POLICY "admins read inst_new_stock_queue"
  ON public.institutional_new_stock_queue FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

INSERT INTO public.tw_bsr_sync_config (key, config, note) VALUES
  ('cold_start_status',
   '{"state":"idle","days_done":0,"days_total":60,"cursor_date":null,"started_at":null,"finished_at":null,"source":null}'::jsonb,
   'PR-1 冷啟動進度'),
  ('keep_warm_schedule',
   '{"enabled":false,"waves":["15:30+08","17:30+08","19:30+08"]}'::jsonb,
   'PR-3 三波 keep-warm cron 開關'),
  ('circuit_breaker_config',
   '{"enabled":false,"fail_threshold":3,"window_minutes":10,"success_rate_threshold":0.5,"cooldown_minutes":15,"probe_interval_minutes":30}'::jsonb,
   'PR-7 熔斷器參數'),
  ('fastlane_enabled', '{"enabled":false,"daily_stock_cap":50}'::jsonb, 'PR-5 新股 fast-lane'),
  ('ui_state_machine_enabled', '{"enabled":false}'::jsonb, 'PR-6 前端 5 狀態機灰度'),
  ('warm_chips_cache_enabled', '{"enabled":false,"rps":5}'::jsonb, 'PR-6 抽屜快取預熱')
ON CONFLICT (key) DO NOTHING;

-- v_active_tw_holdings: 從 instrument 抓開頭 4 碼（排除權證 5+ 碼）
CREATE OR REPLACE VIEW public.v_active_tw_holdings AS
SELECT DISTINCT substring(tr.instrument FROM '^([1-9][0-9]{3})(?:\s|$)') AS stock_id
FROM public.trade_records tr
WHERE tr.market = 'TW'
  AND tr.status::text = 'open'
  AND tr.instrument ~ '^[1-9][0-9]{3}(?:\s|$)';
GRANT SELECT ON public.v_active_tw_holdings TO authenticated;
GRANT SELECT ON public.v_active_tw_holdings TO service_role;

CREATE OR REPLACE FUNCTION public.get_coverage_stats(
  _scope TEXT DEFAULT 'active_holdings',
  _window_days INT DEFAULT 60
)
RETURNS TABLE (
  total_stocks INT, ready INT, filling INT, missing INT, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cutoff DATE := (now() AT TIME ZONE 'Asia/Taipei')::date - _window_days;
BEGIN
  IF _scope <> 'active_holdings' THEN RAISE EXCEPTION 'unsupported scope: %', _scope; END IF;
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN RAISE EXCEPTION 'admin only'; END IF;

  RETURN QUERY
  WITH stocks AS (SELECT stock_id FROM public.v_active_tw_holdings WHERE stock_id IS NOT NULL),
  coverage AS (
    SELECT s.stock_id,
           COUNT(DISTINCT tid.trade_date) FILTER (WHERE tid.trade_date >= _cutoff) AS days_covered
    FROM stocks s
    LEFT JOIN public.tw_institutional_daily tid ON tid.stock_id = s.stock_id
    GROUP BY s.stock_id
  )
  SELECT
    (SELECT COUNT(*)::int FROM stocks),
    COUNT(*) FILTER (WHERE days_covered >= LEAST(_window_days, 40))::int,
    COUNT(*) FILTER (WHERE days_covered > 0 AND days_covered < LEAST(_window_days, 40))::int,
    COUNT(*) FILTER (WHERE days_covered = 0)::int,
    now()
  FROM coverage;
END;
$$;
REVOKE ALL ON FUNCTION public.get_coverage_stats(TEXT, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.get_coverage_stats(TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_updated_at_generic()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_data_source_health ON public.data_source_health;
CREATE TRIGGER trg_touch_data_source_health
  BEFORE UPDATE ON public.data_source_health
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_generic();
DROP TRIGGER IF EXISTS trg_touch_inst_new_stock_queue ON public.institutional_new_stock_queue;
CREATE TRIGGER trg_touch_inst_new_stock_queue
  BEFORE UPDATE ON public.institutional_new_stock_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_generic();
