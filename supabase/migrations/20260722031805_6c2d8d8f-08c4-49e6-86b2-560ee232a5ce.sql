CREATE OR REPLACE FUNCTION public.enforce_unit_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_unit text;
  v_existing_source text;
  v_asset_class text;
  v_allowed text[];
  v_symbol text;
BEGIN
  IF NEW.quantity_unit IS NULL OR btrim(NEW.quantity_unit) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.quantity_unit IS NOT NULL
     AND OLD.quantity_unit = NEW.quantity_unit
     AND OLD.instrument IS NOT DISTINCT FROM NEW.instrument
     AND OLD.expert_id IS NOT DISTINCT FROM NEW.expert_id THEN
    RETURN NEW;
  END IF;

  IF NEW.expert_id IS NULL OR NEW.instrument IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
    INTO v_asset_class
  FROM public.experts
  WHERE id = NEW.expert_id;

  v_allowed := CASE COALESCE(v_asset_class, 'tw_stock')
    WHEN 'tw_stock'  THEN ARRAY['張','股']
    WHEN 'us_stock'  THEN ARRAY['股']
    WHEN 'crypto'    THEN ARRAY['顆']
    WHEN 'us_option' THEN ARRAY['口']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, array_to_string(v_allowed, '/')
      USING ERRCODE = 'check_violation',
            HINT = 'ASSET_UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', asset_class=' || COALESCE(v_asset_class, 'tw_stock')
              || ', attempted_unit=' || NEW.quantity_unit;
  END IF;

  v_symbol := split_part(btrim(NEW.instrument), ' ', 1);

  SELECT quantity_unit, 'expert_signals'
    INTO v_existing_unit, v_existing_source
  FROM public.expert_signals
  WHERE expert_id = NEW.expert_id
    AND split_part(btrim(instrument), ' ', 1) = v_symbol
    AND quantity_unit IS NOT NULL
    AND quantity_unit <> NEW.quantity_unit
    AND status = 'pending'
    AND (TG_TABLE_NAME <> 'expert_signals' OR id <> NEW.id)
  LIMIT 1;

  IF v_existing_unit IS NULL THEN
    SELECT quantity_unit, 'trade_records'
      INTO v_existing_unit, v_existing_source
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND split_part(btrim(instrument), ' ', 1) = v_symbol
      AND quantity_unit IS NOT NULL
      AND quantity_unit <> NEW.quantity_unit
      AND status = 'open'
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 目前有一筆未平倉的「%」單位部位（來源：%），無法在此代碼上同時混用「%」。請先平倉、或到週記編輯頁使用「改單位…」把該部位單位校齊。',
      v_symbol, v_existing_unit, v_existing_source, NEW.quantity_unit
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
                  || ', symbol=' || v_symbol
                  || ', existing_unit=' || v_existing_unit
                  || ', attempted_unit=' || NEW.quantity_unit
                  || ', scope=open_positions_only';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_unit_consistency() IS '單位鎖只作用於未平倉部位；台股允許同代碼在不同持倉週期切換張/股。';