-- 1. Cleanup: delete duplicate trade_records (keep earliest per signal_id, only for open/duplicate rows)
DELETE FROM public.trade_records t
USING (
  SELECT signal_id, min(created_at) AS keep_at
  FROM public.trade_records
  WHERE signal_id IS NOT NULL
  GROUP BY signal_id
  HAVING count(*) > 1
) d
WHERE t.signal_id = d.signal_id
  AND t.created_at > d.keep_at
  AND EXISTS (
    SELECT 1 FROM public.trade_records t2
    WHERE t2.signal_id = t.signal_id AND t2.created_at = d.keep_at
      AND t2.quantity = t.quantity
      AND t2.entry_price IS NOT DISTINCT FROM t.entry_price
      AND t2.status = t.status
  );

-- 2. Fix trigger function: dedupe on buy + add-fallback
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

    IF NEW.action = 'buy' THEN
      SELECT EXISTS(SELECT 1 FROM public.trade_records WHERE signal_id = NEW.id) INTO v_exists;
      IF v_exists THEN
        RETURN NEW;
      END IF;
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, market, currency)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1), v_market, v_currency);

    ELSIF NEW.action = 'add' THEN
      SELECT EXISTS(SELECT 1 FROM public.trade_records WHERE signal_id = NEW.id) INTO v_exists;
      IF v_exists THEN
        RETURN NEW;
      END IF;

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
      SELECT EXISTS(SELECT 1 FROM public.trade_records WHERE signal_id = NEW.id) INTO v_exists;
      IF v_exists THEN
        RETURN NEW;
      END IF;

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

-- 3. Structural guard: only one OPEN trade_record per signal_id
CREATE UNIQUE INDEX IF NOT EXISTS trade_records_signal_id_open_uniq
  ON public.trade_records (signal_id)
  WHERE signal_id IS NOT NULL AND exit_date IS NULL;
