
ALTER TABLE public.checkup_analysis_jobs
  ADD COLUMN IF NOT EXISTS prompts_payload jsonb,
  ADD COLUMN IF NOT EXISTS raw_responses jsonb;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS checkup_complete_line boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS checkup_complete_email boolean NOT NULL DEFAULT true;

-- 同日 queued/running job 唯一性（避免重複觸發）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_checkup_job_active_per_day
  ON public.checkup_analysis_jobs (user_id, ((started_at AT TIME ZONE 'Asia/Taipei')::date))
  WHERE status IN ('queued','running');
