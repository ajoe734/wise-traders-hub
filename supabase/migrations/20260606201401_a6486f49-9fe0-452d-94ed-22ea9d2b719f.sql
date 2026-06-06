-- =====================================================
-- Batch 1 P0: perf_metrics anon GRANT + webhook idempotency
-- =====================================================

-- 1. perf_metrics: anon INSERT 政策早已存在，但缺 GRANT INSERT → 永遠 403
GRANT INSERT ON public.perf_metrics TO anon;
GRANT INSERT ON public.perf_metrics TO authenticated;
GRANT ALL    ON public.perf_metrics TO service_role;

-- 2. LINE webhook idempotency
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  delivery_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS processed_webhook_events_source_delivery_uidx
  ON public.processed_webhook_events(source, delivery_id);

CREATE INDEX IF NOT EXISTS processed_webhook_events_processed_at_idx
  ON public.processed_webhook_events(processed_at);

-- 僅 service_role 使用；anon/authenticated 完全無權
GRANT ALL ON public.processed_webhook_events TO service_role;

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- deny-all policy 滿足 linter（service_role 透過 BYPASSRLS 仍可寫入）
DROP POLICY IF EXISTS "Deny direct access to processed_webhook_events"
  ON public.processed_webhook_events;
CREATE POLICY "Deny direct access to processed_webhook_events"
  ON public.processed_webhook_events
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- 清掃舊紀錄（>7 天）的 RPC
CREATE OR REPLACE FUNCTION public.cleanup_processed_webhook_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.processed_webhook_events
   WHERE processed_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_processed_webhook_events() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_processed_webhook_events() TO service_role;