-- PR-7: 上游熔斷器管理 RPC + 讀取權限
-- 1. 允許 company_admin 讀取 data_source_health（前端監控頁）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'data_source_health'
      AND policyname = 'admin_read_data_source_health'
  ) THEN
    EXECUTE $p$
      CREATE POLICY admin_read_data_source_health
      ON public.data_source_health
      FOR SELECT
      TO authenticated
      USING (public.has_role(auth.uid(), 'company_admin'));
    $p$;
  END IF;
END $$;

GRANT SELECT ON public.data_source_health TO authenticated;

-- 2. 管理員手動重置某來源的熔斷狀態
CREATE OR REPLACE FUNCTION public.reset_data_source_circuit(_source text)
RETURNS public.data_source_health
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.data_source_health;
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION 'forbidden: company_admin required';
  END IF;

  UPDATE public.data_source_health
     SET circuit_state = 'closed',
         consecutive_failures = 0,
         fail_count_10m = 0,
         ok_count_10m = 0,
         disabled_until = NULL,
         updated_at = now()
   WHERE source = _source
  RETURNING * INTO result;

  IF NOT FOUND THEN
    INSERT INTO public.data_source_health (source, circuit_state, updated_at)
    VALUES (_source, 'closed', now())
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_data_source_circuit(text) TO authenticated;