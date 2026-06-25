CREATE TABLE public.admin_view_as_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  consumed_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_view_as_sessions TO service_role;

ALTER TABLE public.admin_view_as_sessions ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: only service_role (edge functions) touches this table.
CREATE POLICY "service_role_full_access_view_as" ON public.admin_view_as_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_view_as_token ON public.admin_view_as_sessions(token);
CREATE INDEX idx_view_as_admin ON public.admin_view_as_sessions(admin_user_id, created_at DESC);