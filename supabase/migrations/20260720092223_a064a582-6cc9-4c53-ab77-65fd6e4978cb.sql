-- 為 BSR 動態設定新增 OCR 前處理模式與升級策略
UPDATE public.tw_bsr_sync_config
SET config = config
  || jsonb_build_object(
    'ocr_mode', COALESCE(config->>'ocr_mode', 'standard'),
    'ocr_escalate_on_fail', COALESCE((config->>'ocr_escalate_on_fail')::boolean, true)
  ),
  note = COALESCE(note, '') || ' | +ocr_mode/escalate defaults'
WHERE key = 'bsr_sync';