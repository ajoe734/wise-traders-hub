
-- BSR queue: split first-fetch (immediate) vs post-close-only refresh
ALTER TABLE public.tw_bsr_sync_queue
  ADD COLUMN IF NOT EXISTS post_close_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tw_bsr_sync_queue_ready_pc_idx
  ON public.tw_bsr_sync_queue (priority, next_run_at)
  WHERE status = 'pending' AND post_close_only = false;

-- Taipei 週一至週五 09:00–13:29 = 盤中
CREATE OR REPLACE FUNCTION public.is_tw_trading_hours()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Taipei') AS ts)
  SELECT
    EXTRACT(ISODOW FROM ts) BETWEEN 1 AND 5
    AND (
      (EXTRACT(HOUR FROM ts) = 9)
      OR (EXTRACT(HOUR FROM ts) BETWEEN 10 AND 12)
      OR (EXTRACT(HOUR FROM ts) = 13 AND EXTRACT(MINUTE FROM ts) < 30)
    )
  FROM t;
$$;

-- 盤中：僅取 post_close_only = false 的 job
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
RETURNS SETOF public.tw_bsr_sync_queue
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending'
      AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
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

-- 一次性：把現存 pending 且該檔已經有歷史資料的，標記為 post_close_only
UPDATE public.tw_bsr_sync_queue q
SET post_close_only = true
WHERE status = 'pending'
  AND post_close_only = false
  AND EXISTS (
    SELECT 1 FROM public.tw_bsr_daily d WHERE d.stock_id = q.stock_id LIMIT 1
  );

-- 新持倉即時鉤子：trade_records insert 時，若該檔 tw_bsr_daily 沒任何資料，
-- 立即塞一筆 P1 immediate 進佇列（post_close_only = false）
CREATE OR REPLACE FUNCTION public.enqueue_bsr_first_fetch_on_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock text;
  v_market text := UPPER(COALESCE(NEW.market, ''));
  v_date date;
BEGIN
  IF v_market NOT IN ('TW', 'TWSE', 'TPEX', '') THEN RETURN NEW; END IF;

  v_stock := substring(COALESCE(NEW.instrument, '') FROM '^([0-9]{4})');
  -- 僅 4 碼、首位 1-9（chip eligible）
  IF v_stock IS NULL OR left(v_stock, 1) = '0' THEN RETURN NEW; END IF;

  -- 已有歷史 → 交給正常收盤後排程處理
  IF EXISTS (SELECT 1 FROM public.tw_bsr_daily WHERE stock_id = v_stock LIMIT 1) THEN
    RETURN NEW;
  END IF;

  -- 取最近一個工作日
  v_date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  WHILE EXTRACT(ISODOW FROM v_date) > 5 LOOP v_date := v_date - 1; END LOOP;

  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
  VALUES
    (v_stock, v_date, 1, 'pending', now(), 'trade_insert_hook', gen_random_uuid(), false)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_trade_records_bsr_first_fetch ON public.trade_records;
CREATE TRIGGER trg_trade_records_bsr_first_fetch
AFTER INSERT ON public.trade_records
FOR EACH ROW EXECUTE FUNCTION public.enqueue_bsr_first_fetch_on_trade();
