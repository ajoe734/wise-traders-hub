
-- 1) 讓 asset_class 鎖定觸發器可以被 SECURITY DEFINER 函式繞過
CREATE OR REPLACE FUNCTION public.enforce_expert_asset_class_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.asset_class IS DISTINCT FROM OLD.asset_class THEN
    -- 管理員專用旁路：admin_reset_expert_asset_class 會先 SET LOCAL 這個變數
    IF coalesce(current_setting('app.bypass_asset_class_lock', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更資產類別（asset_class lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) currency lock 也一樣（trigger 會在 asset_class 同步 currency 時 fire）
CREATE OR REPLACE FUNCTION public.enforce_expert_currency_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    IF coalesce(current_setting('app.bypass_asset_class_lock', true), 'off') = 'on' THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.expert_signals WHERE expert_id = NEW.id LIMIT 1) THEN
      RAISE EXCEPTION '此老師已發布訊號／週記，無法變更幣別（currency lock）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) 管理員 RPC：把 expert 整個從舊資產類別切成新的
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
  -- 只有 company_admin 能呼叫
  IF NOT public.has_role(auth.uid(), 'company_admin') THEN
    RAISE EXCEPTION '權限不足：只有 company_admin 可以重置分析師資產類別'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _new_asset_class NOT IN ('tw_stock', 'us_stock', 'crypto') THEN
    RAISE EXCEPTION '不支援的資產類別：%', _new_asset_class
      USING ERRCODE = 'check_violation';
  END IF;

  -- 本次交易內旁路 asset_class / currency 鎖定
  PERFORM set_config('app.bypass_asset_class_lock', 'on', true);

  -- 舊訊號 → archived（保留可查、與新資產類別的訊號分開）
  UPDATE public.expert_signals
     SET status = 'archived'
   WHERE expert_id = _expert_id
     AND status <> 'archived';
  GET DIAGNOSTICS _archived_count = ROW_COUNT;

  -- 切換 asset_class（sync_expert_currency_with_asset_class trigger 會自動同步 currency）
  -- 起始資金一併清空，讓老師重設新幣別的本金
  UPDATE public.experts
     SET asset_class    = _new_asset_class,
         starting_capital = NULL
   WHERE id = _expert_id;

  -- 稽核
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
