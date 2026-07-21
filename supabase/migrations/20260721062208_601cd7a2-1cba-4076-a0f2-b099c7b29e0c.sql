
-- 1. Rewrite handle_signal_trade to log safe-skip events
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
            'quantity_unit', NEW.quantity_unit,
            'status', NEW.status
          )
        );
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, market, currency)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1), v_market, v_currency);

    ELSIF NEW.action = 'add' THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
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
            market = COALESCE(market, v_market),
            currency = COALESCE(currency, v_currency)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, market, currency)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1), v_market, v_currency);
      END IF;

    ELSIF NEW.action IN ('sell', 'trim') THEN
      SELECT * INTO existing_record
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
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
              status = 'closed'::trade_status
          WHERE id = existing_record.id;
        ELSE
          UPDATE public.trade_records
          SET quantity = remaining_qty
          WHERE id = existing_record.id;

          INSERT INTO public.trade_records (
            expert_id, signal_id, instrument,
            entry_price, entry_date,
            exit_price, exit_date,
            pnl_percent, quantity, status, market, currency
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
          status = 'closed'::trade_status
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Allow expert owners to read logs of their own signals
CREATE POLICY "Experts can view own signal logs"
ON public.function_run_logs
FOR SELECT
TO authenticated
USING (
  expert_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.experts e
    WHERE e.id = function_run_logs.expert_id
      AND e.user_id = auth.uid()
  )
);

-- 3. Index for skip-log lookups
CREATE INDEX IF NOT EXISTS idx_function_run_logs_signal_stage
  ON public.function_run_logs (signal_id, stage, created_at DESC)
  WHERE fn = 'handle_signal_trade';
