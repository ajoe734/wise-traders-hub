CREATE OR REPLACE FUNCTION public.consume_checkup_quota(_user_id uuid, _kind text DEFAULT 'analysis')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q jsonb;
  v_remaining int;
  v_used int;
  v_now timestamptz := now();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('checkup_quota:' || _user_id::text));

  BEGIN
    v_q := public.check_checkup_quota(_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'QUOTA_CHECK_FAILED' USING DETAIL = SQLERRM;
  END;

  v_remaining := COALESCE((v_q->>'remaining')::int, 0);
  v_used := COALESCE((v_q->>'used')::int, 0);

  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED' USING DETAIL = v_q::text;
  END IF;

  INSERT INTO public.checkup_usage (user_id, kind) VALUES (_user_id, COALESCE(_kind, 'analysis'));

  RETURN v_q
    || jsonb_build_object(
         'used', v_used + 1,
         'remaining', GREATEST(v_remaining - 1, 0),
         'last_used_at', v_now
       );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_checkup_quota(uuid, text) TO authenticated, service_role;