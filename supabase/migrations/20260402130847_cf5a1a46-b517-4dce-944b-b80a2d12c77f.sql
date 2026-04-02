
-- NEW-002: handle_signal_takedown — reverse weighted average when ADD signal is taken down
-- NEW-007: handle_signal_trade — cap sell_qty to existing quantity (server-side guard)

CREATE OR REPLACE FUNCTION public.handle_signal_takedown()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining_published integer;
  has_open_trades boolean;
  _user_id uuid;
  _add_qty integer;
  _add_price numeric;
  _open_rec RECORD;
  _new_qty integer;
  _new_entry numeric;
BEGIN
  IF NEW.status = 'taken_down' AND OLD.status = 'published' THEN

    -- NEW-002: If this is an ADD signal being recalled, reverse the weighted average
    IF OLD.action = 'add' AND OLD.quantity IS NOT NULL AND OLD.price_hint IS NOT NULL THEN
      SELECT * INTO _open_rec
      FROM public.trade_records
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND AND _open_rec.quantity > OLD.quantity THEN
        _add_qty := OLD.quantity;
        _add_price := OLD.price_hint;
        _new_qty := _open_rec.quantity - _add_qty;

        IF _new_qty > 0 THEN
          _new_entry := ROUND(
            (_open_rec.quantity * COALESCE(_open_rec.entry_price, 0) - _add_qty * _add_price)
            / _new_qty
          , 2);

          UPDATE public.trade_records
          SET quantity = _new_qty,
              entry_price = _new_entry
          WHERE id = _open_rec.id;
        END IF;
      ELSIF FOUND AND _open_rec.quantity <= OLD.quantity THEN
        -- The ADD was the only addition; delete the open record
        DELETE FROM public.trade_records WHERE id = _open_rec.id;
      END IF;

      RETURN NEW;
    END IF;

    -- Check if there are any other published signals for the same instrument+expert
    SELECT COUNT(*) INTO remaining_published
    FROM public.expert_signals
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'published'
      AND id != NEW.id;

    IF remaining_published = 0 THEN
      SELECT EXISTS (
        SELECT 1 FROM public.trade_records
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'open'
      ) INTO has_open_trades;

      SELECT user_id INTO _user_id
      FROM public.experts
      WHERE id = NEW.expert_id;

      IF has_open_trades THEN
        UPDATE public.trade_records
        SET status = 'closed'::trade_status,
            exit_date = NOW(),
            exit_price = current_price,
            pnl_percent = CASE
              WHEN entry_price IS NOT NULL AND entry_price > 0 AND current_price IS NOT NULL
              THEN ROUND(((current_price - entry_price) / entry_price) * 100, 2)
              ELSE pnl_percent
            END
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'open';
      ELSE
        DELETE FROM public.trade_records
        WHERE expert_id = NEW.expert_id
          AND instrument = NEW.instrument
          AND status = 'closed';
      END IF;

      IF _user_id IS NOT NULL THEN
        DELETE FROM public.trade_signals
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1)
          AND status = 'closed';

        UPDATE public.trade_signals
        SET status = 'closed',
            closed_at = NOW()
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1)
          AND status = 'open';

        DELETE FROM public.user_performances
        WHERE user_id = _user_id
          AND symbol = split_part(NEW.instrument, ' ', 1);
      END IF;
    ELSE
      UPDATE public.trade_records
      SET status = 'stopped'::trade_status,
          exit_date = NOW(),
          exit_price = current_price
      WHERE signal_id = NEW.id
        AND status = 'open';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- NEW-007: Cap sell_qty to existing quantity in handle_signal_trade
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
BEGIN
  IF NEW.status IN ('published', 'pending') THEN
    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1));

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
            quantity = existing_record.quantity + COALESCE(NEW.quantity, 1)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, COALESCE(NEW.published_at, NOW()), 'open'::trade_status, COALESCE(NEW.quantity, 1));
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
            pnl_percent, quantity, status
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
            'closed'::trade_status
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
          status = 'stopped'::trade_status
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
