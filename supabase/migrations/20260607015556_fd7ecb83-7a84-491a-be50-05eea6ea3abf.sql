CREATE TABLE public.line_oauth_states (
  state TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.line_oauth_states TO service_role;

ALTER TABLE public.line_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny direct access to line_oauth_states"
  ON public.line_oauth_states
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX idx_line_oauth_states_expires ON public.line_oauth_states (expires_at);

CREATE OR REPLACE FUNCTION public.cleanup_line_oauth_states()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.line_oauth_states
  WHERE expires_at < now() - INTERVAL '1 hour'
     OR (consumed_at IS NOT NULL AND consumed_at < now() - INTERVAL '1 hour');
$$;