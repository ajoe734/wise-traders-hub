CREATE TABLE IF NOT EXISTS public.line_login_nonces (
  nonce uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_login_nonces_expires ON public.line_login_nonces(expires_at);

GRANT ALL ON public.line_login_nonces TO service_role;

ALTER TABLE public.line_login_nonces ENABLE ROW LEVEL SECURITY;
-- intentionally no anon/authenticated policies: only service_role may read/write.