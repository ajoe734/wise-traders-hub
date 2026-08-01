CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_shares numeric;
  v_required numeric;
  v_available numeric;
  v_self_cost numeric := 0;
  v_status jsonb;
  v_currency text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;

  -- 只有會真正建帳（pending / published）的列需要檢核
  IF NEW.status NOT IN ('pending','published') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(currency, 'TWD'), COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_currency, v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口','組']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NEW.quantity_unit IS NOT NULL AND NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, array_to_string(v_allowed, '/')
      USING ERRCODE = 'check_violation';
  END IF;

  -- 關鍵修正：pending 插入時 handle_signal_trade 就已建立 trade_records（資金已扣），
  -- 之後 pending -> published 只是狀態轉換，不可再扣一次，否則會 CAPITAL_EXCEEDED 卡住發布。
  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending','published') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_combo, false) THEN
    IF COALESCE(NEW.max_loss_per_unit, 0) <= 0 THEN
      RAISE EXCEPTION 'COMBO_MAX_LOSS_REQUIRED: 組合單必須提供每組最大損失（max_loss_per_unit）才能發布。'
        USING ERRCODE = 'check_violation';
    END IF;
    v_required := NEW.max_loss_per_unit * GREATEST(COALESCE(NEW.quantity, 1), 1);
  ELSE
    v_shares := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'tw_stock' AND COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      WHEN COALESCE(v_asset_class, 'tw_stock') = 'us_option' THEN COALESCE(NEW.quantity, 1) * 100
      ELSE COALESCE(NEW.quantity, 1)
    END;
    v_required := COALESCE(NEW.price_hint, 0) * v_shares;
  END IF;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  -- 防禦：若本筆 signal 已有自己的 trade_record（重試 / 補寫情境），把自身成本加回避免雙重計算
  SELECT COALESCE(SUM(COALESCE(quantity,0) * COALESCE(entry_price,0)), 0)
    INTO v_self_cost
  FROM public.trade_records
  WHERE signal_id = NEW.id AND status = 'open';

  v_available := v_available + COALESCE(v_self_cost, 0);

  IF v_required > v_available THEN
    RAISE EXCEPTION
      'CAPITAL_EXCEEDED: 此筆需 % %，可用現金僅 % %。請至「分析師設定」調整初始資金，或減少數量。',
      v_required, COALESCE(v_currency, 'TWD'), v_available, COALESCE(v_currency, 'TWD')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;