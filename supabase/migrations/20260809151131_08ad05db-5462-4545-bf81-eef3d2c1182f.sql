CREATE TABLE IF NOT EXISTS public.signal_trade_applications (
  signal_id uuid PRIMARY KEY REFERENCES public.expert_signals(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL,
  action text NOT NULL,
  applied_quantity integer,
  tg_op text,
  applied_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.signal_trade_applications TO authenticated;
GRANT ALL ON public.signal_trade_applications TO service_role;

ALTER TABLE public.signal_trade_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company admins can view signal trade applications" ON public.signal_trade_applications;
CREATE POLICY "Company admins can view signal trade applications"
ON public.signal_trade_applications FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'company_admin'::app_role));

INSERT INTO public.signal_trade_applications (signal_id, expert_id, action, applied_quantity, tg_op, applied_at)
SELECT s.id, s.expert_id, s.action::text, s.quantity, 'BACKFILL', COALESCE(s.published_at, s.created_at)
FROM public.expert_signals s
WHERE s.action::text IN ('buy','add','sell','trim','exit')
  AND s.status::text IN ('published','pending')
ON CONFLICT (signal_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_signal_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_asset_class text;
  v_trade_qty integer;
  v_inserted integer;
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

    SELECT COALESCE(asset_class, CASE WHEN currency = 'USD' THEN 'us_stock' ELSE 'tw_stock' END)
      INTO v_asset_class
    FROM public.experts
    WHERE id = NEW.expert_id;

    v_asset_class := COALESCE(v_asset_class, 'tw_stock');

    v_market := CASE v_asset_class
      WHEN 'us_stock' THEN 'US'
      WHEN 'us_option' THEN 'US'
      WHEN 'us_future' THEN 'US'
      WHEN 'crypto' THEN 'CRYPTO'
      ELSE 'TW'
    END;

    v_currency := CASE v_asset_class
      WHEN 'us_stock' THEN 'USD'
      WHEN 'us_option' THEN 'USD'
      WHEN 'us_future' THEN 'USD'
      WHEN 'crypto' THEN 'USD'
      ELSE 'TWD'
    END;

    v_unit := COALESCE(
      NULLIF(btrim(NEW.quantity_unit), ''),
      CASE v_asset_class
        WHEN 'tw_stock' THEN '張'
        WHEN 'us_stock' THEN '股'
        WHEN 'crypto' THEN '顆'
        WHEN 'us_option' THEN '口'
        WHEN 'us_future' THEN '口'
        ELSE CASE WHEN v_currency = 'USD' THEN '股' ELSE '張' END
      END
    );

    v_trade_qty := CASE
      WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
      WHEN v_asset_class = 'tw_stock' AND v_unit = '張' THEN COALESCE(NEW.quantity, 1) * 1000
      ELSE COALESCE(NEW.quantity, 1)
    END;

    IF NEW.action IN ('buy', 'add', 'sell', 'trim', 'exit') THEN
      INSERT INTO public.signal_trade_applications (signal_id, expert_id, action, applied_quantity, tg_op)
      VALUES (NEW.id, NEW.expert_id, NEW.action::text, v_trade_qty, TG_OP)
      ON CONFLICT (signal_id) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      IF v_inserted = 0 THEN
        INSERT INTO public.function_run_logs
          (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
        VALUES (
          'handle_signal_trade',
          gen_random_uuid()::text,
          'info',
          'skipped_already_applied',
          format('signal %s 先前已套用過（%s），本次 %s 安全跳過（防重複）',
                 NEW.id, NEW.action, TG_OP),
          NEW.id,
          NEW.expert_id,
          jsonb_build_object(
            'action', NEW.action,
            'instrument', NEW.instrument,
            'tg_op', TG_OP,
            'quantity', NEW.quantity,
            'quantity_unit', v_unit,
            'trade_quantity', v_trade_qty,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;

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
            'trade_quantity', v_trade_qty,
            'asset_class', v_asset_class,
            'market', v_market,
            'currency', v_currency,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, v_trade_qty, v_unit, v_market, v_currency);

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
              WHEN (existing_record.quantity + v_trade_qty) > 0
              THEN ROUND(
                (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
                 + v_trade_qty * COALESCE(NEW.price_hint, 0))
                / (existing_record.quantity + v_trade_qty)
              , 2)
              ELSE existing_record.entry_price
            END,
            quantity = existing_record.quantity + v_trade_qty,
            quantity_unit = COALESCE(existing_record.quantity_unit, v_unit),
            market = COALESCE(market, v_market),
            currency = COALESCE(currency, v_currency)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit, market, currency)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, v_trade_qty, v_unit, v_market, v_currency);
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
        sell_qty := LEAST(v_trade_qty, existing_record.quantity);
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
$function$;