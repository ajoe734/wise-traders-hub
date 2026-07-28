
-- Locked-down secret storage for cron dispatch
CREATE TABLE IF NOT EXISTS public.internal_cron_secrets (
  id INT PRIMARY KEY DEFAULT 1,
  cron_key TEXT NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT internal_cron_secrets_singleton CHECK (id = 1)
);
GRANT ALL ON public.internal_cron_secrets TO service_role;
-- NO grants to authenticated/anon: locked to service_role only.
ALTER TABLE public.internal_cron_secrets ENABLE ROW LEVEL SECURITY;
-- No policies = no access for anon/authenticated even if grants were added later.

INSERT INTO public.internal_cron_secrets (id, cron_key)
VALUES (1, encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- SECURITY DEFINER dispatcher: pg_cron jobs call this instead of net.http_post directly.
-- Injects X-Cron-Key header from the locked secret table so the secret never appears
-- in cron.job.command.
CREATE OR REPLACE FUNCTION public.cron_edge_call(fn_name TEXT, body JSONB DEFAULT '{}'::jsonb)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_url TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT cron_key INTO v_key FROM public.internal_cron_secrets WHERE id = 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'cron_edge_call: CRON_SHARED_SECRET row missing';
  END IF;
  v_url := 'https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/' || fn_name;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Key', v_key,
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo'
    ),
    body := COALESCE(body, '{}'::jsonb)
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cron_edge_call(TEXT, JSONB) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.cron_edge_call(TEXT, JSONB) TO service_role, postgres;

-- Convenience: read current key (used by bootstrap to sync CRON_SHARED_SECRET env var)
CREATE OR REPLACE FUNCTION public.get_cron_key()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cron_key FROM public.internal_cron_secrets WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.get_cron_key() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_key() TO service_role, postgres;
