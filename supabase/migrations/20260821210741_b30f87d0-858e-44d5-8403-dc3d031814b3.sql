CREATE OR REPLACE FUNCTION public.sample_caller_is_service_bootstrap()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  su text := session_user::text;   -- SQL keyword: the login role, NOT rewritten by SECURITY DEFINER
  claims jsonb;
  jrole text;
BEGIN
  -- Direct owner / superuser database sessions (migrations, psql as postgres).
  IF su IN ('postgres', 'supabase_admin') THEN
    RETURN true;
  END IF;

  -- PostgREST sessions: login role is always 'authenticator'; effective role comes from the
  -- signature-verified JWT claim. anon / authenticated JWTs never satisfy this.
  IF su <> 'authenticator' THEN
    RETURN false;
  END IF;

  BEGIN
    claims := pg_catalog.current_setting('request.jwt.claims', true)::jsonb;
  EXCEPTION WHEN others THEN
    claims := NULL;
  END;

  jrole := claims->>'role';
  RETURN jrole = 'service_role';
END;
$function$;

REVOKE ALL ON FUNCTION public.sample_caller_is_service_bootstrap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sample_caller_is_service_bootstrap() FROM anon;
REVOKE ALL ON FUNCTION public.sample_caller_is_service_bootstrap() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sample_caller_is_service_bootstrap() TO service_role;