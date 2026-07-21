-- 2026-07-21：資料庫層級的單位一致性守門
-- 防止同一位老師 + 同一標的的 quantity_unit 被改成不一致（造成 UNIT_MIX / UNIT_A_NE_B）

CREATE OR REPLACE FUNCTION public.enforce_unit_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_unit text;
  v_existing_source text;
BEGIN
  -- 新資料未指定單位 → 不檢查（允許保留 NULL）
  IF NEW.quantity_unit IS NULL OR btrim(NEW.quantity_unit) = '' THEN
    RETURN NEW;
  END IF;

  -- UPDATE：單位未變動 → 略過
  IF TG_OP = 'UPDATE'
     AND OLD.quantity_unit IS NOT NULL
     AND OLD.quantity_unit = NEW.quantity_unit THEN
    RETURN NEW;
  END IF;

  -- 缺 expert_id 或 instrument → 無法比對，放行（其他 constraint 會處理）
  IF NEW.expert_id IS NULL OR NEW.instrument IS NULL THEN
    RETURN NEW;
  END IF;

  -- 從兩張表找是否已存在不同單位的記錄
  SELECT quantity_unit, 'expert_signals'
    INTO v_existing_unit, v_existing_source
  FROM public.expert_signals
  WHERE expert_id = NEW.expert_id
    AND instrument = NEW.instrument
    AND quantity_unit IS NOT NULL
    AND quantity_unit <> NEW.quantity_unit
    AND (TG_TABLE_NAME <> 'expert_signals' OR id <> NEW.id)
  LIMIT 1;

  IF v_existing_unit IS NULL THEN
    SELECT quantity_unit, 'trade_records'
      INTO v_existing_unit, v_existing_source
    FROM public.trade_records
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND quantity_unit IS NOT NULL
      AND quantity_unit <> NEW.quantity_unit
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 已存在單位「%」的記錄（來源：%），無法改用「%」。請先在後台修正舊記錄或使用相同單位。',
      NEW.instrument, v_existing_unit, v_existing_source, NEW.quantity_unit
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
                  || ', instrument=' || NEW.instrument
                  || ', existing_unit=' || v_existing_unit
                  || ', attempted_unit=' || NEW.quantity_unit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_unit_consistency_expert_signals ON public.expert_signals;
CREATE TRIGGER trg_enforce_unit_consistency_expert_signals
  BEFORE INSERT OR UPDATE OF quantity_unit, instrument, expert_id ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_unit_consistency();

DROP TRIGGER IF EXISTS trg_enforce_unit_consistency_trade_records ON public.trade_records;
CREATE TRIGGER trg_enforce_unit_consistency_trade_records
  BEFORE INSERT OR UPDATE OF quantity_unit, instrument, expert_id ON public.trade_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_unit_consistency();

COMMENT ON FUNCTION public.enforce_unit_consistency() IS
  '單位一致性守門：同一位 expert_id + instrument 的 quantity_unit 一旦建立即鎖定，'
  '避免 UNIT_MIX / UNIT_A_NE_B 漂移。錯誤訊息 HINT 帶 UNIT_LOCK: 前綴供前端解析。';
