-- 重排 jobid 54：擴大批量 + 週末也跑 + 每 30 分鐘一次
SELECT cron.unschedule(54);

SELECT cron.schedule(
  'tw-bsr-window-converge-halfhour',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/tw-bsr-window-converge',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
    body := jsonb_build_object('max_stocks', 200, 'chunk_dates', 30, 'horizon_days', 110)
  );
  $$
);

-- 立即為所有活躍持倉觸發一次收斂，避免等到下個整點
SELECT public.converge_bsr_windows(200, 30, 110);
