
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

  IF _new_asset_class NOT IN ('tw_stock', 'us_stock', 'crypto') THEN
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

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
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
