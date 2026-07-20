ALTER TABLE public.tw_bsr_attempt_logs ADD COLUMN IF NOT EXISTS adaptive_strategy jsonb;
COMMENT ON COLUMN public.tw_bsr_attempt_logs.adaptive_strategy IS
  '自適應 OCR 策略決策：{ base_mode, effective_mode, variants, exhaustive, escalate_on_last, triggers: [{ rule, from, to, reason }], consec_before }。null 代表本次未套用策略（未啟用或首次嘗試）。';
CREATE INDEX IF NOT EXISTS idx_tw_bsr_attempt_logs_adaptive_gin
  ON public.tw_bsr_attempt_logs USING gin (adaptive_strategy jsonb_path_ops)
  WHERE adaptive_strategy IS NOT NULL;