
-- 1) 提高每日入列上限
UPDATE public.tw_bsr_sync_config
   SET config = jsonb_set(config, '{daily_stock_cap}', '500'::jsonb)
 WHERE key = 'fastlane_enabled';

-- 2) 立刻把所有相關台股 4 位數代號批次入列（bypass RPC 的 daily cap）
INSERT INTO public.institutional_new_stock_queue (stock_id, status, attempts, next_attempt_at)
SELECT sid, 'pending', 0, now()
FROM (
  SELECT DISTINCT SPLIT_PART(TRIM(instrument),' ',1) AS sid FROM public.expert_signals WHERE market='TW'
  UNION
  SELECT DISTINCT SPLIT_PART(TRIM(instrument),' ',1) AS sid FROM public.trade_records WHERE market='TW'
  UNION
  SELECT DISTINCT stock_id AS sid FROM public.v_active_tw_holdings
) s
WHERE sid ~ '^[1-9][0-9]{3}$'
ON CONFLICT (stock_id) DO UPDATE
   SET status='pending', attempts=0, next_attempt_at=now(),
       last_error=NULL, updated_at=now()
   WHERE public.institutional_new_stock_queue.status <> 'running';

-- 3) 自動收斂：把覆蓋 <40 日的股票每日排回佇列
CREATE OR REPLACE FUNCTION public.enqueue_institutional_backfill_universe()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n INT;
BEGIN
  WITH universe AS (
    SELECT DISTINCT SPLIT_PART(TRIM(instrument),' ',1) AS sid FROM public.expert_signals WHERE market='TW'
    UNION
    SELECT DISTINCT SPLIT_PART(TRIM(instrument),' ',1) AS sid FROM public.trade_records WHERE market='TW'
    UNION
    SELECT DISTINCT stock_id AS sid FROM public.v_active_tw_holdings
  ),
  valid AS (SELECT sid FROM universe WHERE sid ~ '^[1-9][0-9]{3}$'),
  cov AS (SELECT stock_id, COUNT(*) d FROM public.tw_institutional_daily GROUP BY stock_id),
  targets AS (
    SELECT v.sid FROM valid v LEFT JOIN cov ON cov.stock_id=v.sid
     WHERE COALESCE(cov.d,0) < 40
  ),
  ins AS (
    INSERT INTO public.institutional_new_stock_queue (stock_id, status, attempts, next_attempt_at)
    SELECT sid, 'pending', 0, now() FROM targets
    ON CONFLICT (stock_id) DO UPDATE
       SET status='pending', attempts=0, next_attempt_at=now(),
           last_error=NULL, updated_at=now()
       WHERE public.institutional_new_stock_queue.status <> 'running'
    RETURNING 1
  )
  SELECT COUNT(*) INTO _n FROM ins;
  RETURN _n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_institutional_backfill_universe() TO service_role;

-- 4) 每天台北時間 06:15 收斂一次
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='tw-inst-backfill-enqueue';
SELECT cron.schedule(
  'tw-inst-backfill-enqueue',
  '15 22 * * *',  -- 22:15 UTC = 06:15 Asia/Taipei
  $$SELECT public.enqueue_institutional_backfill_universe();$$
);

-- 5) 提高 fastlane worker 每輪批量到 10 檔（原本 5）
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='tw-institutional-fastlane';
SELECT cron.schedule(
  'tw-institutional-fastlane',
  '*/5 6-11 * * 1-5',
  $$SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/tw-institutional-daily-sync',
      headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"fastlane","batch":10,"days":60}'::jsonb
   );$$
);
