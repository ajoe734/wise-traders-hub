CREATE OR REPLACE FUNCTION public.protect_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when invoked from edge functions with service role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow company_admin to change anything
  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- Block non-admin users from changing privileged fields
  IF NEW.is_tester IS DISTINCT FROM OLD.is_tester THEN
    RAISE EXCEPTION 'You cannot modify tester status';
  END IF;
  IF NEW.expert_slug IS DISTINCT FROM OLD.expert_slug THEN
    RAISE EXCEPTION 'You cannot modify expert slug';
  END IF;

  RETURN NEW;
END;
$function$;