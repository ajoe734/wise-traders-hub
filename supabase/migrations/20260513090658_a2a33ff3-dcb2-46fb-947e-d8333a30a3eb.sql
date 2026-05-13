CREATE INDEX IF NOT EXISTS idx_ck_validations_created_at ON public.checkup_knowledge_validations(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_backtest_runs_created_at ON public.knowledge_backtest_runs(created_at);

DELETE FROM public.checkup_knowledge_validations
WHERE created_at < (now() - interval '30 days');

DELETE FROM public.knowledge_backtest_runs
WHERE created_at < (now() - interval '14 days');