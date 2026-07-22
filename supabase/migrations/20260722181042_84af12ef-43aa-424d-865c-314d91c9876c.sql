
-- B5: Admin RPC 包裝 trade_records 刪除，權限集中在 DB 側
CREATE OR REPLACE FUNCTION public.admin_delete_trade_records_by_signal_ids(_signal_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer;
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- 授權：company_admin 或 呼叫者是 expert.user_id
  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.trade_records tr
      JOIN public.experts e ON e.id = tr.expert_id
      WHERE tr.signal_id = ANY(_signal_ids) AND e.user_id = _caller
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.trade_records WHERE signal_id = ANY(_signal_ids);
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_trade_records_by_symbol(
  _expert_id uuid,
  _symbol_prefix text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer;
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF _symbol_prefix IS NULL OR length(trim(_symbol_prefix)) = 0 THEN
    RAISE EXCEPTION 'symbol_prefix required' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.has_role(_caller, 'company_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = _expert_id AND e.user_id = _caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.trade_records
   WHERE expert_id = _expert_id
     AND instrument ILIKE (_symbol_prefix || '%');
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_trade_records_by_signal_ids(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_trade_records_by_symbol(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_trade_records_by_signal_ids(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_trade_records_by_symbol(uuid, text) TO authenticated;

-- 未檢查項目 1（RLS 補洞）：holdings_fix_proposals INSERT 政策 qual 為空 → 任何登入者可插入
DROP POLICY IF EXISTS "Company admins can insert fix proposals" ON public.holdings_fix_proposals;
CREATE POLICY "Company admins can insert fix proposals"
  ON public.holdings_fix_proposals
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'::app_role));

-- B6：暫停 admin-line-push-cron（token 未設）
SELECT cron.unschedule('admin-line-push-cron-every-minute');
