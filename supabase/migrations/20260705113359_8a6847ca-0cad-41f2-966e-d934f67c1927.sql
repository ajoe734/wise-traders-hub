CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role (edge functions) — auth.uid() is NULL when called with service role
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- For regular users, block changes to sensitive fields
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'You cannot modify subscription status';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'You cannot modify subscription expiry';
  END IF;
  IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'You cannot modify subscription start date';
  END IF;
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'You cannot modify subscription plan';
  END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
    RAISE EXCEPTION 'You cannot modify payment provider';
  END IF;

  RETURN NEW;
END;
$function$;