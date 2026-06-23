-- 收斂 Realtime broadcast：移除整表 publication，改為僅必要欄位
ALTER PUBLICATION supabase_realtime DROP TABLE public.checkup_analysis_jobs;

ALTER PUBLICATION supabase_realtime ADD TABLE public.checkup_analysis_jobs
  (id, user_id, status, error_text, finished_at);

-- REPLICA IDENTITY 從 FULL 改回 DEFAULT（只需 PK，搭配欄位過濾足以送出狀態更新）
ALTER TABLE public.checkup_analysis_jobs REPLICA IDENTITY DEFAULT;