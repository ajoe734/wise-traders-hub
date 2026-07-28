-- M-3a: Edge function auth failure event log
CREATE TABLE IF NOT EXISTS public.edge_function_auth_events (
  id BIGSERIAL PRIMARY KEY,
  fn_name TEXT NOT NULL,
  auth_class TEXT NOT NULL CHECK (auth_class IN ('user','cron','webhook','public','unknown')),
  outcome INT NOT NULL,           -- HTTP status: 200/401/403/503
  code TEXT,                       -- e.g. UNAUTHENTICATED / FORBIDDEN_CRON / CRON_SECRET_MISSING
  reason TEXT,                     -- short message
  caller_ip TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.edge_function_auth_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.edge_function_auth_events_id_seq TO service_role;

ALTER TABLE public.edge_function_auth_events ENABLE ROW LEVEL SECURITY;

-- No policies: service_role bypasses RLS; nobody else may read/write.

CREATE INDEX IF NOT EXISTS idx_edge_auth_events_fn_time
  ON public.edge_function_auth_events (fn_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_auth_events_time
  ON public.edge_function_auth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_auth_events_outcome_time
  ON public.edge_function_auth_events (outcome, created_at DESC)
  WHERE outcome >= 400;

-- Cleanup helper (7 day retention)
CREATE OR REPLACE FUNCTION public.cleanup_old_auth_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM public.edge_function_auth_events
   WHERE created_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_auth_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_auth_events() TO service_role;