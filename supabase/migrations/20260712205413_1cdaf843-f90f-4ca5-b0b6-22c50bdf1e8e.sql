
ALTER TABLE public.expert_ai_training_sessions
  DROP CONSTRAINT IF EXISTS expert_ai_training_sessions_status_check;
ALTER TABLE public.expert_ai_training_sessions
  ADD CONSTRAINT expert_ai_training_sessions_status_check
  CHECK (status IN ('open','in_progress','reviewing','completed','discarded'));
