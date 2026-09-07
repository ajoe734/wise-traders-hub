CREATE TABLE IF NOT EXISTS public.checkup_pending_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.checkup_plans(id),
  months integer NOT NULL DEFAULT 2,
  note text,
  granted_by uuid,
  consumed_at timestamptz,
  consumed_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS checkup_pending_grants_email_open_idx
  ON public.checkup_pending_grants (lower(email)) WHERE consumed_at IS NULL;

GRANT ALL ON public.checkup_pending_grants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkup_pending_grants TO authenticated;

ALTER TABLE public.checkup_pending_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage pending grants" ON public.checkup_pending_grants;
CREATE POLICY "admins manage pending grants" ON public.checkup_pending_grants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

CREATE OR REPLACE FUNCTION public.consume_checkup_pending_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_grant public.checkup_pending_grants%ROWTYPE;
BEGIN
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = NEW.user_id;
  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_grant
  FROM public.checkup_pending_grants
  WHERE lower(email) = v_email AND consumed_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.checkup_subscriptions (user_id, plan_id, billing_cycle, status, auto_renew, started_at, expires_at)
  VALUES (NEW.user_id, v_grant.plan_id, 'monthly', 'active', false, now(), now() + make_interval(months => v_grant.months));

  UPDATE public.checkup_pending_grants
  SET consumed_at = now(), consumed_user_id = NEW.user_id
  WHERE id = v_grant.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_checkup_pending_grant ON public.profiles;
CREATE TRIGGER trg_consume_checkup_pending_grant
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.consume_checkup_pending_grant();