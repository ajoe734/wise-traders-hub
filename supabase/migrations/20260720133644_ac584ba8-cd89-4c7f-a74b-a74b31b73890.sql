
-- ============================================================================
-- 1. tw_bsr_sync_queue：分層工作佇列
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tw_bsr_sync_queue (
  id bigserial PRIMARY KEY,
  stock_id text NOT NULL,
  trade_date date NOT NULL,
  priority smallint NOT NULL CHECK (priority IN (1,2,3)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error text,
  enqueued_by text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 同一 stock+date 只保留一筆 pending/running（避免重複入列）
CREATE UNIQUE INDEX IF NOT EXISTS tw_bsr_sync_queue_active_uniq
  ON public.tw_bsr_sync_queue (stock_id, trade_date)
  WHERE status IN ('pending','running');

CREATE INDEX IF NOT EXISTS tw_bsr_sync_queue_ready_idx
  ON public.tw_bsr_sync_queue (priority, next_run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS tw_bsr_sync_queue_status_idx
  ON public.tw_bsr_sync_queue (status, updated_at DESC);

GRANT SELECT ON public.tw_bsr_sync_queue TO authenticated;
GRANT ALL ON public.tw_bsr_sync_queue TO service_role;

ALTER TABLE public.tw_bsr_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_admin_can_read_bsr_queue" ON public.tw_bsr_sync_queue
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service_role_manages_bsr_queue" ON public.tw_bsr_sync_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tw_bsr_sync_queue_touch_updated()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_tw_bsr_sync_queue_updated ON public.tw_bsr_sync_queue;
CREATE TRIGGER trg_tw_bsr_sync_queue_updated
  BEFORE UPDATE ON public.tw_bsr_sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.tw_bsr_sync_queue_touch_updated();

-- ============================================================================
-- 2. tw_bsr_api_usage：API 用量計數（滑動視窗）
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tw_bsr_api_usage (
  bucket_start timestamptz NOT NULL,
  api_name text NOT NULL DEFAULT 'finmind',
  call_count int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  rate_limited_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_start, api_name)
);

CREATE INDEX IF NOT EXISTS tw_bsr_api_usage_recent_idx
  ON public.tw_bsr_api_usage (api_name, bucket_start DESC);

GRANT SELECT ON public.tw_bsr_api_usage TO authenticated;
GRANT ALL ON public.tw_bsr_api_usage TO service_role;

ALTER TABLE public.tw_bsr_api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_admin_can_read_bsr_usage" ON public.tw_bsr_api_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE POLICY "service_role_manages_bsr_usage" ON public.tw_bsr_api_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- 3. 限流器：檢查最近 60 分鐘用量
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_bsr_rate_limit(_limit int DEFAULT 1500, _api text DEFAULT 'finmind')
RETURNS TABLE (used int, remaining int, allowed boolean)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _used int;
BEGIN
  SELECT COALESCE(SUM(call_count), 0)::int INTO _used
  FROM public.tw_bsr_api_usage
  WHERE api_name = _api
    AND bucket_start >= now() - interval '60 minutes';
  used := _used;
  remaining := GREATEST(0, _limit - _used);
  allowed := _used < _limit;
  RETURN NEXT;
END; $$;

GRANT EXECUTE ON FUNCTION public.check_bsr_rate_limit(int, text) TO authenticated, service_role;

-- 記錄呼叫（call/success/error/429）
CREATE OR REPLACE FUNCTION public.record_bsr_api_call(
  _api text DEFAULT 'finmind',
  _success boolean DEFAULT true,
  _rate_limited boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _bucket timestamptz := date_trunc('minute', now());
BEGIN
  INSERT INTO public.tw_bsr_api_usage (bucket_start, api_name, call_count, success_count, error_count, rate_limited_count)
  VALUES (
    _bucket, _api, 1,
    CASE WHEN _success THEN 1 ELSE 0 END,
    CASE WHEN _success THEN 0 ELSE 1 END,
    CASE WHEN _rate_limited THEN 1 ELSE 0 END
  )
  ON CONFLICT (bucket_start, api_name) DO UPDATE SET
    call_count = tw_bsr_api_usage.call_count + 1,
    success_count = tw_bsr_api_usage.success_count + CASE WHEN _success THEN 1 ELSE 0 END,
    error_count = tw_bsr_api_usage.error_count + CASE WHEN _success THEN 0 ELSE 1 END,
    rate_limited_count = tw_bsr_api_usage.rate_limited_count + CASE WHEN _rate_limited THEN 1 ELSE 0 END;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_bsr_api_call(text, boolean, boolean) TO service_role;

-- ============================================================================
-- 4. 佇列取件（原子、SKIP LOCKED）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch int DEFAULT 20, _max_priority int DEFAULT 3)
RETURNS SETOF public.tw_bsr_sync_queue
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending'
      AND priority <= _max_priority
      AND next_run_at <= now()
    ORDER BY priority ASC, next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT _batch
  )
  UPDATE public.tw_bsr_sync_queue q
  SET status = 'running', started_at = now(), attempts = q.attempts + 1
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END; $$;

GRANT EXECUTE ON FUNCTION public.claim_bsr_queue_jobs(int, int) TO service_role;

-- ============================================================================
-- 5. 每日清理：只保留 30 天內完成/失敗紀錄
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prune_bsr_sync_queue()
RETURNS int LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _deleted int;
BEGIN
  DELETE FROM public.tw_bsr_sync_queue
  WHERE status IN ('done','failed','skipped')
    AND finished_at < now() - interval '30 days';
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  DELETE FROM public.tw_bsr_api_usage
  WHERE bucket_start < now() - interval '14 days';
  RETURN _deleted;
END; $$;

GRANT EXECUTE ON FUNCTION public.prune_bsr_sync_queue() TO service_role;
