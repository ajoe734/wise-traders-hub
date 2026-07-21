
-- 1) 解除 tier3_paused，恢復 normal
UPDATE public.tw_bsr_sync_config
SET config = jsonb_build_object(
  'mode','normal',
  'previous_mode','tier3_paused',
  'reason','manual_reset_stuck_paused',
  'since', to_jsonb(now()),
  'last_transition_at', to_jsonb(now())
),
updated_at = now(),
version = version + 1
WHERE key = 'degrade:finmind';

-- 2) 把因 not_chip_eligible 被 skip 的 ETF/00xxx 重新標記為 pending，讓 worker 重試
--    （由 sync 端決定 FinMind 是否有資料；若真沒有再讓失敗機制處理）
UPDATE public.tw_bsr_sync_queue
SET status='pending', attempts=0, last_error=NULL,
    next_run_at=now(), updated_at=now()
WHERE status='skipped' AND last_error='not_chip_eligible';

-- 3) 記錄一次 degrade event 方便回溯
INSERT INTO public.tw_bsr_degrade_events
  (api_name, from_mode, to_mode, reason, trigger_metric, trigger_value, threshold, correlation_id, detail)
VALUES
  ('finmind','tier3_paused','normal','manual_reset_stuck_paused','manual',NULL,NULL,NULL,'{"note":"cooldown expired but did not auto-recover"}'::jsonb);
