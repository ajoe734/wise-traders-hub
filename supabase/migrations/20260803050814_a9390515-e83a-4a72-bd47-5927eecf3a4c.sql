ALTER TABLE public.data_source_refresh_logs
  DROP CONSTRAINT IF EXISTS data_source_refresh_logs_status_check;
ALTER TABLE public.data_source_refresh_logs
  ADD CONSTRAINT data_source_refresh_logs_status_check
  CHECK (status = ANY (ARRAY['running'::text,'success'::text,'error'::text,'partial'::text,'skipped'::text]));