SELECT cron.schedule(
  'fx-rate-sync-every-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/fx-rate-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  );
  $$
);