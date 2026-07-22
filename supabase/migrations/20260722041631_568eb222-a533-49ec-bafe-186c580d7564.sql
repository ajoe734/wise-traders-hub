
CREATE OR REPLACE FUNCTION public.enforce_unit_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_unit    text;
  v_existing_source  text;
  v_existing_row_id  text;
  v_existing_symbol  text;
  v_existing_qty     numeric;
  v_existing_created timestamptz;
  v_asset_class      text;
  v_allowed          text[];
  v_allowed_str      text;
  v_symbol           text;
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
  v_allowed_str := array_to_string(v_allowed, '/');

  IF NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION
      '單位不相容：資產類別「%」不支援單位「%」，允許的單位為「%」。',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'ASSET_UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', asset_class=' || COALESCE(v_asset_class, 'tw_stock')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str;
  END IF;

  v_symbol := split_part(btrim(NEW.instrument), ' ', 1);

  -- 先找 pending 訊號中的衝突
  SELECT quantity_unit, 'expert_signals', id::text,
         split_part(btrim(instrument), ' ', 1), quantity, created_at
    INTO v_existing_unit, v_existing_source, v_existing_row_id,
         v_existing_symbol, v_existing_qty, v_existing_created
  FROM public.expert_signals
  WHERE expert_id = NEW.expert_id
    AND split_part(btrim(instrument), ' ', 1) = v_symbol
    AND quantity_unit IS NOT NULL
    AND quantity_unit <> NEW.quantity_unit
    AND status = 'pending'
    AND (TG_TABLE_NAME <> 'expert_signals' OR id <> NEW.id)
  ORDER BY created_at ASC
  LIMIT 1;

  -- 再找 open 部位
  IF v_existing_unit IS NULL THEN
    SELECT quantity_unit, 'trade_records', id::text,
           split_part(btrim(instrument), ' ', 1), quantity, created_at
      INTO v_existing_unit, v_existing_source, v_existing_row_id,
           v_existing_symbol, v_existing_qty, v_existing_created
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND split_part(btrim(instrument), ' ', 1) = v_symbol
      AND quantity_unit IS NOT NULL
      AND quantity_unit <> NEW.quantity_unit
      AND status = 'open'
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 目前已有一筆未平倉部位使用「%」單位（來源：% #%，數量 % %，建立於 %），無法在此代碼上同時混用「%」。允許單位：%。請先平倉，或到週記編輯頁使用「改單位…」把該部位單位校齊。',
      v_symbol,
      v_existing_unit,
      v_existing_source,
      v_existing_row_id,
      v_existing_qty,
      v_existing_unit,
      to_char(v_existing_created AT TIME ZONE 'Asia/Taipei', 'YYYY/MM/DD HH24:MI'),
      NEW.quantity_unit,
      v_allowed_str
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
              || ', symbol=' || v_symbol
              || ', existing_source=' || v_existing_source
              || ', existing_row_id=' || v_existing_row_id
              || ', existing_unit=' || v_existing_unit
              || ', existing_quantity=' || COALESCE(v_existing_qty::text, '')
              || ', attempted_unit=' || NEW.quantity_unit
              || ', allowed_units=' || v_allowed_str
              || ', scope=open_positions_only';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_unit_consistency() IS
  '單位鎖只作用於未平倉部位（trade_records.status=open + expert_signals.status=pending）；錯誤訊息會指出造成鎖定的具體來源筆與允許單位選項。';
