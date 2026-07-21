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
      AND (TG_TABLE_NAME <> 'trade_records' OR id <> NEW.id)
    LIMIT 1;
  END IF;

  IF v_existing_unit IS NOT NULL THEN
    RAISE EXCEPTION
      '單位不一致：標的 % 已存在單位「%」的記錄（來源：%），無法改用「%」。請先在週記編輯頁使用「改單位…」校齊，或使用相同單位。',
      v_symbol, v_existing_unit, v_existing_source, NEW.quantity_unit
      USING ERRCODE = 'check_violation',
            HINT = 'UNIT_LOCK: expert_id=' || NEW.expert_id::text
                  || ', symbol=' || v_symbol
                  || ', existing_unit=' || v_existing_unit
                  || ', attempted_unit=' || NEW.quantity_unit;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_signal_capital_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_shares numeric;
  v_required numeric;
  v_available numeric;
  v_status jsonb;
  v_currency text;
  v_asset_class text;
  v_allowed text[];
BEGIN
  IF NEW.action NOT IN ('buy','add') THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'company_admin') THEN
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
    WHEN 'us_option' THEN ARRAY['口']
    WHEN 'us_future' THEN ARRAY['口']
    ELSE ARRAY['張','股']
  END;

  IF NEW.quantity_unit IS NOT NULL AND NOT (NEW.quantity_unit = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'incompatible_unit_for_asset_class: % 不支援單位「%」（僅允許 %）',
      COALESCE(v_asset_class, 'tw_stock'), NEW.quantity_unit, array_to_string(v_allowed, '/')
      USING ERRCODE = 'check_violation';
  END IF;

  v_shares := CASE
    WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
    WHEN COALESCE(v_asset_class, 'tw_stock') = 'tw_stock' AND COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
    ELSE COALESCE(NEW.quantity, 1)
  END;

  v_required := COALESCE(NEW.price_hint, 0) * v_shares;

  v_status := public.get_expert_capital_status(NEW.expert_id);
  v_available := COALESCE((v_status->>'available_cash')::numeric, 0);

  IF v_required > v_available THEN
    RAISE EXCEPTION
      'CAPITAL_EXCEEDED: 此筆需 % %，可用現金僅 % %。請至「分析師設定」調整初始資金，或減少數量。',
      v_required, COALESCE(v_currency, 'TWD'), v_available, COALESCE(v_currency, 'TWD')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_signal_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_record RECORD;
  sell_qty integer;
  remaining_qty integer;
  v_first text;
  v_market text;
  v_currency text;
  v_exists boolean;
  v_existing_trade_id uuid;
  v_unit text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('published', 'pending') THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.status IN ('published', 'pending') THEN
    v_first := split_part(COALESCE(NEW.instrument, ''), ' ', 1);
    IF v_first ~ '^[A-Za-z][A-Za-z0-9.\-]{0,9}$' THEN
      v_market := 'US';
      v_currency := 'USD';
    ELSE
      v_market := 'TW';
      v_currency := 'TWD';
    END IF;

    v_unit := COALESCE(NEW.quantity_unit, CASE WHEN v_currency = 'USD' THEN '股' ELSE '張' END);

    IF NEW.action IN ('buy', 'add', 'sell', 'trim') THEN
      SELECT id INTO v_existing_trade_id FROM public.trade_records WHERE signal_id = NEW.id LIMIT 1;
      v_exists := v_existing_trade_id IS NOT NULL;
      IF v_exists THEN
        INSERT INTO public.function_run_logs
          (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
        VALUES (
          'handle_signal_trade',
          gen_random_uuid()::text,
          'info',
          'skipped_existing_trade',
          format('signal %s 已對應 trade_record %s，%s 動作安全跳過（防重複）',
                 NEW.id, v_existing_trade_id, NEW.action),
          NEW.id,
          NEW.expert_id,
          jsonb_build_object(
            'action', NEW.action,
            'instrument', NEW.instrument,
            'tg_op', TG_OP,
            'existing_trade_id', v_existing_trade_id,
            'quantity', NEW.quantity,
            'quantity_unit', v_unit,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1), v_unit, v_market, v_currency);

    ELSIF NEW.action = 'add' THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.trade_records
        SET entry_price = CASE
              WHEN (existing_record.quantity + COALESCE(NEW.quantity, 1)) > 0
              THEN ROUND(
                (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
                 + COALESCE(NEW.quantity, 1) * COALESCE(NEW.price_hint, 0))
                / (existing_record.quantity + COALESCE(NEW.quantity, 1))
              , 2)
              ELSE existing_record.entry_price
            END,
            quantity = existing_record.quantity + COALESCE(NEW.quantity, 1),
            quantity_unit = COALESCE(existing_record.quantity_unit, v_unit),
            market = COALESCE(market, v_market),
            currency = COALESCE(currency, v_currency)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1), v_unit, v_market, v_currency);
      END IF;

    ELSIF NEW.action IN ('sell', 'trim') THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        sell_qty := LEAST(COALESCE(NEW.quantity, existing_record.quantity), existing_record.quantity);
        remaining_qty := existing_record.quantity - sell_qty;

        IF remaining_qty <= 0 THEN
          UPDATE public.trade_records
          SET exit_price = NEW.price_hint,
              exit_date = COALESCE(NEW.published_at, NOW()),
              pnl_percent = CASE
                WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
                THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
                ELSE NULL
              END,
              quantity = 0,
              quantity_unit = COALESCE(quantity_unit, existing_record.quantity_unit, v_unit),
              status = 'closed'::trade_status
          WHERE id = existing_record.id;
        ELSE
          UPDATE public.trade_records
          SET quantity = remaining_qty,
              quantity_unit = COALESCE(quantity_unit, existing_record.quantity_unit, v_unit)
          WHERE id = existing_record.id;

          INSERT INTO public.trade_records (
            expert_id, signal_id, instrument,
            entry_price, entry_date,
            exit_price, exit_date,
            pnl_percent, quantity, quantity_unit, status, market, currency
          ) VALUES (
            NEW.expert_id, NEW.id, NEW.instrument,
            existing_record.entry_price, existing_record.entry_date,
            NEW.price_hint, COALESCE(NEW.published_at, NOW()),
            CASE
              WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
              THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
              ELSE NULL
            END,
            sell_qty,
            COALESCE(existing_record.quantity_unit, v_unit),
            'closed'::trade_status,
            COALESCE(existing_record.market, v_market),
            COALESCE(existing_record.currency, v_currency)
          );
        END IF;
      END IF;

    ELSIF NEW.action = 'exit' THEN
      UPDATE public.trade_records
      SET exit_price = NEW.price_hint,
          exit_date = COALESCE(NEW.published_at, NOW()),
          pnl_percent = CASE
            WHEN entry_price IS NOT NULL AND entry_price > 0
            THEN ROUND(((NEW.price_hint - entry_price) / entry_price) * 100, 2)
            ELSE NULL
          END,
          quantity = 0,
          quantity_unit = COALESCE(quantity_unit, v_unit),
          status = 'closed'::trade_status
      WHERE expert_id = NEW.expert_id
        AND split_part(btrim(instrument), ' ', 1) = v_first
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_unit_consistency() IS '單位一致性與資產類別守門：同一位 expert_id + symbol 的 quantity_unit 一旦建立即鎖定，且不得違反 expert.asset_class。';