
-- Add quantity_unit to expert_signals and trade_records
ALTER TABLE public.expert_signals ADD COLUMN IF NOT EXISTS quantity_unit text NOT NULL DEFAULT '張';
ALTER TABLE public.trade_records ADD COLUMN IF NOT EXISTS quantity_unit text NOT NULL DEFAULT '張';

-- Update trigger to pass quantity_unit through
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
  v_unit text;
BEGIN
  IF NEW.status = 'published' THEN
    v_unit := COALESCE(NEW.quantity_unit, '張');

    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit)
      VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, NEW.published_at, 'open'::trade_status, COALESCE(NEW.quantity, 1), v_unit);

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
        SET quantity = existing_record.quantity + COALESCE(NEW.quantity, 1)
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit)
        VALUES (NEW.expert_id, NEW.id, NEW.instrument, NEW.price_hint, NEW.published_at, 'open'::trade_status, COALESCE(NEW.quantity, 1), v_unit);
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
        sell_qty := COALESCE(NEW.quantity, existing_record.quantity);
        remaining_qty := existing_record.quantity - sell_qty;

        IF remaining_qty <= 0 THEN
          UPDATE public.trade_records
          SET exit_price = NEW.price_hint,
              exit_date = NEW.published_at,
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
            pnl_percent, quantity, quantity_unit, status
          ) VALUES (
            NEW.expert_id, NEW.id, NEW.instrument,
            existing_record.entry_price, existing_record.entry_date,
            NEW.price_hint, NEW.published_at,
            CASE
              WHEN existing_record.entry_price IS NOT NULL AND existing_record.entry_price > 0
              THEN ROUND(((NEW.price_hint - existing_record.entry_price) / existing_record.entry_price) * 100, 2)
              ELSE NULL
            END,
            sell_qty,
            v_unit,
            'closed'::trade_status
          );
        END IF;
      END IF;

    ELSIF NEW.action = 'exit' THEN
      UPDATE public.trade_records
      SET exit_price = NEW.price_hint,
          exit_date = NEW.published_at,
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
