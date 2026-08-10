DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.checkup_prefetch_universe() TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.detect_chip_gap_jobs(date, integer, integer) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.detect_institutional_gap_jobs(date, integer, integer) TO sandbox_exec';
  END IF;
END $$;
