-- 串流健康度 / 追蹤鏈查詢加速索引
-- 現有：run_id / (fn, created_at DESC) / level
-- 新增：
--   1. payload->>'correlationId'（trace 頁 OR 查詢用；用 partial index 排除沒帶此鍵的列）
--   2. payload->>'requestId'    （trace 頁 OR 查詢用）
--   3. (payload->>'terminatedBy', created_at DESC) partial fn='stream-metrics-report'
--      供 StreamHealth 之後把 terminatedBy 篩選下推到 SQL 時用；即使目前在 client 篩，
--      SELECT ... WHERE fn=... AND created_at>= 這段仍會落到 idx_function_run_logs_fn_created。

CREATE INDEX IF NOT EXISTS idx_function_run_logs_payload_correlation_id
  ON public.function_run_logs ((payload->>'correlationId'))
  WHERE payload ? 'correlationId';

CREATE INDEX IF NOT EXISTS idx_function_run_logs_payload_request_id
  ON public.function_run_logs ((payload->>'requestId'))
  WHERE payload ? 'requestId';

CREATE INDEX IF NOT EXISTS idx_function_run_logs_stream_terminated_created
  ON public.function_run_logs ((payload->>'terminatedBy'), created_at DESC)
  WHERE fn = 'stream-metrics-report';