-- 放寬三個 CHECK constraint 白名單
ALTER TABLE public.experts
  DROP CONSTRAINT IF EXISTS experts_asset_class_check;
ALTER TABLE public.experts
  ADD CONSTRAINT experts_asset_class_check
  CHECK (asset_class IN ('tw_stock','us_stock','crypto','us_option','us_future'));

ALTER TABLE public.current_prices
  DROP CONSTRAINT IF EXISTS current_prices_asset_class_check;
ALTER TABLE public.current_prices
  ADD CONSTRAINT current_prices_asset_class_check
  CHECK (asset_class IN ('tw_stock','us_stock','crypto','us_option','us_future'));

ALTER TABLE public.stock_names
  DROP CONSTRAINT IF EXISTS stock_names_asset_class_check;
ALTER TABLE public.stock_names
  ADD CONSTRAINT stock_names_asset_class_check
  CHECK (asset_class IN ('tw_stock','us_stock','crypto','us_option','us_future'));

-- currency 同步 trigger：新增兩類 → USD
CREATE OR REPLACE FUNCTION public.sync_expert_currency_with_asset_class()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.asset_class = 'tw_stock' THEN
    NEW.currency := 'TWD';
  ELSIF NEW.asset_class IN ('us_stock','crypto','us_option','us_future') THEN
    NEW.currency := 'USD';
  END IF;
  RETURN NEW;
END;
$$;

-- admin_reset_expert_asset_class：白名單同步放寬
CREATE OR REPLACE FUNCTION public.admin_reset_expert_asset_class(
  _expert_id uuid,
  _new_asset_class text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _archived_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION '權限不足：只有 company_admin 可以重置分析師資產類別'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _new_asset_class NOT IN ('tw_stock','us_stock','crypto','us_option','us_future') THEN
    RAISE EXCEPTION '不支援的資產類別：%', _new_asset_class
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.bypass_asset_class_lock', 'on', true);

  UPDATE public.expert_signals
     SET status = 'archived'
   WHERE expert_id = _expert_id
     AND status <> 'archived';
  GET DIAGNOSTICS _archived_count = ROW_COUNT;

  UPDATE public.experts
     SET asset_class    = _new_asset_class,
         starting_capital = NULL
   WHERE id = _expert_id;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, meta)
  VALUES (
    auth.uid(),
    'admin_reset_expert_asset_class',
    'experts',
    _expert_id,
    jsonb_build_object(
      'new_asset_class', _new_asset_class,
      'archived_signals', _archived_count
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_expert_asset_class(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_expert_asset_class(uuid, text) TO authenticated;