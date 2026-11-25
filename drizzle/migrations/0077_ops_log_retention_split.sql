CREATE OR REPLACE FUNCTION public.cleanup_ops_boot_and_run_logs(_max_rows integer DEFAULT 300000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  boot_deleted integer := 0;
  run_deleted integer := 0;
  n integer;
BEGIN
  LOOP
    DELETE FROM public.edge_boot_events
     WHERE id IN (SELECT id FROM public.edge_boot_events
                   WHERE boot_at < now() - interval '7 days' LIMIT 20000);
    GET DIAGNOSTICS n = ROW_COUNT;
    boot_deleted := boot_deleted + n;
    EXIT WHEN n = 0 OR boot_deleted >= _max_rows;
  END LOOP;
  DELETE FROM public.function_run_logs WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS run_deleted = ROW_COUNT;
  RETURN jsonb_build_object('edge_boot_events', boot_deleted, 'function_run_logs', run_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_ops_boot_and_run_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_ops_boot_and_run_logs(integer) TO service_role;