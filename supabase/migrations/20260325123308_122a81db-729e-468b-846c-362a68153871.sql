ALTER TABLE public.expert_signals ADD COLUMN IF NOT EXISTS teaching_topic text;
ALTER TABLE public.expert_signals ADD COLUMN IF NOT EXISTS overall_summary text;