ALTER TABLE public.tw_bsr_attempt_logs ADD COLUMN IF NOT EXISTS ocr_trace jsonb;
COMMENT ON COLUMN public.tw_bsr_attempt_logs.ocr_trace IS
  '每一次 OCR 重試的多變體軌跡：{retry, mode, strategy[], variants[{variant,guess,elapsed_ms}], consensus(majority/fallback_first/none), adopted{variant,text,votes}, post_outcome(accepted/empty/mismatch)}';
CREATE INDEX IF NOT EXISTS idx_tw_bsr_attempt_logs_ocr_trace_gin
  ON public.tw_bsr_attempt_logs USING gin (ocr_trace jsonb_path_ops)
  WHERE ocr_trace IS NOT NULL;