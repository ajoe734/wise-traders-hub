
-- Fix 1: Set search_path on functions
CREATE OR REPLACE FUNCTION public.enforce_snapshot_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  force_flag TEXT;
  target_date DATE;
BEGIN
  target_date := COALESCE(NEW.trade_date, OLD.trade_date);

  IF NOT public.is_snapshot_sealed(target_date) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    force_flag := current_setting('app.force_reseal', true);
  EXCEPTION WHEN OTHERS THEN
    force_flag := NULL;
  END;

  IF force_flag = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'snapshot_sealed: %(row) on % is sealed; set app.force_reseal=true to override',
    TG_TABLE_NAME, target_date
    USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_batch_attempts_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

-- Fix 2: Switch views to security_invoker (respect caller RLS)
ALTER VIEW public.chip_fact_conflicts SET (security_invoker = on);
ALTER VIEW public.chip_fact_health SET (security_invoker = on);
ALTER VIEW public.v_price_sync_universe SET (security_invoker = on);
ALTER VIEW public.v_price_freshness SET (security_invoker = on);
ALTER VIEW public.payment_providers_safe SET (security_invoker = on);

-- Fix 3: Scope remittance_account to users with a pending order, remove broad policy
DROP POLICY IF EXISTS "Anyone can read remittance account" ON public.payment_settings;

CREATE OR REPLACE FUNCTION public.get_remittance_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  uid uuid := auth.uid();
  has_pending boolean;
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Allow if user has any pending/awaiting remittance order, or is a company admin
  SELECT EXISTS (
    SELECT 1 FROM public.remittance_orders
    WHERE user_id = uid
      AND status IN ('pending', 'awaiting_confirmation', 'submitted', 'awaiting_payment')
  ) INTO has_pending;

  IF NOT has_pending AND NOT public.has_role(uid, 'company_admin'::app_role) THEN
    RETURN NULL;
  END IF;

  SELECT value INTO result
  FROM public.payment_settings
  WHERE key = 'remittance_account';

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_remittance_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_remittance_account() TO authenticated;
