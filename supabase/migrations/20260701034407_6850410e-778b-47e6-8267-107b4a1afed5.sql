
-- 1) profiles: mark merged secondary accounts
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS merged_into_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_merged_into ON public.profiles(merged_into_user_id) WHERE merged_into_user_id IS NOT NULL;

-- 2) account_link_codes: 6-digit binding codes
CREATE TABLE IF NOT EXISTS public.account_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  initiator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initiator_identity text NOT NULL,           -- 'email' | 'line' (for UX display)
  initiator_email text,
  initiator_line_user_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.account_link_codes TO authenticated;
GRANT ALL ON public.account_link_codes TO service_role;

ALTER TABLE public.account_link_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own codes select"
  ON public.account_link_codes FOR SELECT
  TO authenticated
  USING (initiator_user_id = auth.uid() OR consumed_by_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_alc_initiator ON public.account_link_codes(initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_alc_expires ON public.account_link_codes(expires_at);

-- 3) account_merges: audit trail
CREATE TABLE IF NOT EXISTS public.account_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_user_id uuid NOT NULL,
  secondary_user_id uuid NOT NULL,
  primary_identity text,      -- 'email' | 'line'
  secondary_identity text,
  primary_email text,
  secondary_email text,
  moved_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(secondary_user_id)
);

GRANT SELECT ON public.account_merges TO authenticated;
GRANT ALL ON public.account_merges TO service_role;

ALTER TABLE public.account_merges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self or admin can view merges"
  ON public.account_merges FOR SELECT
  TO authenticated
  USING (
    primary_user_id = auth.uid()
    OR secondary_user_id = auth.uid()
    OR has_role(auth.uid(), 'company_admin'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_am_primary ON public.account_merges(primary_user_id);

-- 4) cleanup helper (optional cron target later)
CREATE OR REPLACE FUNCTION public.cleanup_account_link_codes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.account_link_codes
   WHERE expires_at < now() - interval '1 day'
      OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '7 days');
$$;
