CREATE OR REPLACE FUNCTION public.get_remittance_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
BEGIN
  -- 未登入者一律看不到收款帳號
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 已登入會員皆可讀：
  -- 1) 結帳頁在建立訂單「之前」就要顯示收款帳號
  -- 2) 實際訂單狀態使用 awaiting_info，舊白名單未涵蓋，導致一律回 NULL
  SELECT value INTO result
  FROM public.payment_settings
  WHERE key = 'remittance_account';

  RETURN result;
END;
$function$;