
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule cleanup every 2 minutes for minute-level precision
-- The cleanup_old_announcements function deletes records older than 7 days
-- Running every 2 min ensures deletion within ~2 minutes of the 7-day mark
SELECT cron.schedule(
  'cleanup-old-announcements-every-2min',
  '*/2 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/cleanup-announcements-cron',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body := concat('{"time": "', now(), '"}')::jsonb
    ) AS request_id;
  $$
);
