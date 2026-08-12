-- Build 1f — claim_bsr_queue_jobs token slot（公平性：每 invocation 最多 1 個 recovery token）
-- canonical source: supabase/tests/fixtures/bsr_claim_planned.sql（逐字同源，由 scripts/bsr-claim-equivalence.sh 強制檢查）
-- 本檔不得含 GRANT / ALTER OWNER：ACL 屬 production read-back 項目。

CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
 RETURNS SETOF tw_bsr_sync_queue
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH token_slot AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending'
      AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error = 'quota_recovery_token'
    ORDER BY next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(1, GREATEST(_batch, 0))
  ),
  normal AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending'
      AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error IS DISTINCT FROM 'quota_recovery_token'
    ORDER BY priority ASC, next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(_batch - (SELECT count(*) FROM token_slot), 0)
  ),
  picked AS (
    SELECT id, 0 AS bucket FROM token_slot
    UNION ALL
    SELECT id, 1 AS bucket FROM normal
  ),
  updated AS (
    UPDATE public.tw_bsr_sync_queue q
    SET status = 'running', started_at = now(), attempts = q.attempts + 1
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.* FROM updated u
  JOIN picked p ON p.id = u.id
  ORDER BY p.bucket ASC, u.priority ASC, u.next_run_at ASC, u.id ASC;
END;
$function$;
