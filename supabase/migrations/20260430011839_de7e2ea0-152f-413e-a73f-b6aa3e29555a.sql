-- 1. Create system_jobs_log table for cron/system tasks
CREATE TABLE IF NOT EXISTS public.system_jobs_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  detail JSONB DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  ran_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_jobs_log_ran_at ON public.system_jobs_log (ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_jobs_log_job_name ON public.system_jobs_log (job_name);

ALTER TABLE public.system_jobs_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins view system jobs"
ON public.system_jobs_log FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'company_admin'::app_role));

CREATE POLICY "Company admins insert system jobs"
ON public.system_jobs_log FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'company_admin'::app_role));

-- 2. Migrate existing system noise out of audit_logs
INSERT INTO public.system_jobs_log (job_name, status, detail, ran_at)
SELECT
  action AS job_name,
  COALESCE(detail->>'status', 'success') AS status,
  detail,
  created_at AS ran_at
FROM public.audit_logs
WHERE action IN ('stock_price_sync', 'daily_performance_update', 'daily_snapshot', 'mentor_journal_publish', 'announcement_cleanup', 'checkup_price_refresh');

DELETE FROM public.audit_logs
WHERE action IN ('stock_price_sync', 'daily_performance_update', 'daily_snapshot', 'mentor_journal_publish', 'announcement_cleanup', 'checkup_price_refresh');

-- 3. Allow audit_logs INSERT from anyone authenticated as long as actor_id matches (loosen for non-admin roles like analyst self-actions in future, but keep admin-only for now via existing policy)
-- (No change — existing policy already correct)
