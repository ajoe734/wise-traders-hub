ALTER TABLE public.expert_ai_training_sessions
  ADD COLUMN IF NOT EXISTS revisions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.expert_ai_training_sessions.revisions IS
  '歷史版本快照陣列。每次「重新產題／重新產候選」前，把當時的 ai_questions/answers/suggested_knowledge/suggested_journal_edits 連同時間、觸發動作與觸發者存入這裡，供事後追蹤。';