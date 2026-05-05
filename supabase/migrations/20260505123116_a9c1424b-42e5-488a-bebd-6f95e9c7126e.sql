-- 1) Remove duplicate trade trigger so one signal only writes once
DROP TRIGGER IF EXISTS on_signal_trade ON public.expert_signals;

-- 2) Normalize handle_signal_trade to store actual shares in trade_records.quantity
CREATE OR REPLACE FUNCTION public.handle_signal_trade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_record RECORD;
  signal_shares integer;
  sell_qty integer;
  remaining_qty integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('published', 'pending') THEN
      RETURN NEW;
    END IF;
  END IF;

  signal_shares := CASE
    WHEN COALESCE(NEW.quantity, 0) <= 0 THEN 1
    WHEN COALESCE(NEW.quantity_unit, '張') = '張' THEN COALESCE(NEW.quantity, 1) * 1000
    ELSE COALESCE(NEW.quantity, 1)
  END;

  IF NEW.status IN ('published', 'pending') THEN
    IF NEW.action = 'buy' THEN
      INSERT INTO public.trade_records (
        expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit
      )
      VALUES (
        NEW.expert_id,
        NEW.id,
        NEW.instrument,
        NEW.price_hint,
        COALESCE(NEW.published_at, NOW()),
        'open'::trade_status,
        signal_shares,
        '股'
      );

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
              WHEN (existing_record.quantity + signal_shares) > 0
              THEN ROUND(
                (existing_record.quantity * COALESCE(existing_record.entry_price, 0)
                 + signal_shares * COALESCE(NEW.price_hint, 0))
                / (existing_record.quantity + signal_shares)
              , 2)
              ELSE existing_record.entry_price
            END,
            quantity = existing_record.quantity + signal_shares,
            quantity_unit = '股'
        WHERE id = existing_record.id;
      ELSE
        INSERT INTO public.trade_records (
          expert_id, signal_id, instrument, entry_price, entry_date, status, quantity, quantity_unit
        )
        VALUES (
          NEW.expert_id,
          NEW.id,
          NEW.instrument,
          NEW.price_hint,
          COALESCE(NEW.published_at, NOW()),
          'open'::trade_status,
          signal_shares,
          '股'
        );
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
        sell_qty := LEAST(signal_shares, existing_record.quantity);
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
              quantity_unit = '股',
              status = 'closed'::trade_status
          WHERE id = existing_record.id;
        ELSE
          UPDATE public.trade_records
          SET quantity = remaining_qty,
              quantity_unit = '股'
          WHERE id = existing_record.id;

          INSERT INTO public.trade_records (
            expert_id, signal_id, instrument,
            entry_price, entry_date,
            exit_price, exit_date,
            pnl_percent, quantity, quantity_unit, status
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
            '股',
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
          quantity_unit = '股',
          status = 'closed'::trade_status
      WHERE expert_id = NEW.expert_id
        AND instrument = NEW.instrument
        AND status = 'open'
        AND exit_price IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Backfill existing trade_records quantities to actual shares where older rows still store lots
UPDATE public.trade_records tr
SET quantity = CASE
      WHEN COALESCE(es.quantity_unit, tr.quantity_unit, '張') = '張' THEN COALESCE(tr.quantity, 0) * 1000
      ELSE COALESCE(tr.quantity, 0)
    END,
    quantity_unit = '股'
FROM public.expert_signals es
WHERE es.id = tr.signal_id
  AND tr.quantity > 0
  AND COALESCE(tr.quantity_unit, es.quantity_unit, '張') <> '股';

-- 4) Remove exact duplicate trade_records created by duplicate triggers (keep earliest row)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY expert_id,
                        signal_id,
                        instrument,
                        entry_price,
                        exit_price,
                        entry_date,
                        exit_date,
                        pnl_percent,
                        status,
                        quantity,
                        quantity_unit,
                        current_price,
                        price_updated_at,
                        created_at
           ORDER BY id
         ) AS rn
  FROM public.trade_records
  WHERE signal_id IS NOT NULL
)
DELETE FROM public.trade_records tr
USING ranked r
WHERE tr.id = r.id
  AND r.rn > 1;

-- 5) Rebuild calculate_expert_performance using actual shares, not hardcoded lots
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  total_trades integer;
  winning_trades integer;
  cumulative_ret numeric;
  max_dd numeric;
  avg_hold numeric;
  profit_sum numeric;
  loss_sum numeric;
  avg_pnl numeric;
  rec record;
  peak numeric := 0;
  running_sum numeric := 0;
  worst_dd numeric := 0;
  one_year_ago timestamp with time zone := NOW() - INTERVAL '1 year';
  return_1y numeric;
  v_current_asset numeric := 0;
  v_starting_capital numeric := 0;
  v_realized_amount numeric := 0;
  v_unrealized_amount numeric := 0;
  v_open_market_value numeric := 0;
  v_open_cost_value numeric := 0;
  v_total_return_pct numeric := 0;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pnl_percent > 0),
    COALESCE(SUM(pnl_percent), 0),
    COALESCE(AVG(pnl_percent), 0),
    COALESCE(AVG(EXTRACT(EPOCH FROM (exit_date - entry_date)) / 86400), 0),
    COALESCE(SUM(pnl_percent) FILTER (WHERE pnl_percent > 0), 0),
    COALESCE(ABS(SUM(pnl_percent) FILTER (WHERE pnl_percent < 0)), 0)
  INTO total_trades, winning_trades, cumulative_ret, avg_pnl, avg_hold, profit_sum, loss_sum
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed', 'stopped');

  FOR rec IN
    SELECT pnl_percent, exit_date
    FROM public.trade_records
    WHERE expert_id = _expert_id
      AND status IN ('closed', 'stopped')
      AND pnl_percent IS NOT NULL
    ORDER BY exit_date ASC NULLS LAST, created_at ASC
  LOOP
    running_sum := running_sum + rec.pnl_percent;
    IF running_sum > peak THEN
      peak := running_sum;
    END IF;
    IF (peak - running_sum) > worst_dd THEN
      worst_dd := peak - running_sum;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(pnl_percent), 0)
  INTO return_1y
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed', 'stopped')
    AND pnl_percent IS NOT NULL
    AND exit_date >= one_year_ago;

  max_dd := worst_dd;

  SELECT COALESCE(starting_capital, 0)
  INTO v_starting_capital
  FROM public.experts
  WHERE id = _expert_id;

  SELECT COALESCE(SUM(
    COALESCE(tr.quantity, 0) * (COALESCE(tr.exit_price, tr.entry_price, 0) - COALESCE(tr.entry_price, 0))
  ), 0)
  INTO v_realized_amount
  FROM public.trade_records tr
  WHERE tr.expert_id = _expert_id
    AND tr.status IN ('closed', 'stopped');

  SELECT
    COALESCE(SUM(tr.quantity * COALESCE(cp.price, tr.current_price, tr.entry_price, 0)), 0),
    COALESCE(SUM(tr.quantity * COALESCE(tr.entry_price, 0)), 0)
  INTO v_open_market_value, v_open_cost_value
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id
    AND tr.status = 'open';

  v_unrealized_amount := v_open_market_value - v_open_cost_value;

  IF v_starting_capital > 0 THEN
    v_current_asset := v_starting_capital + v_realized_amount + v_unrealized_amount;
    v_total_return_pct := ROUND(((v_current_asset - v_starting_capital) / v_starting_capital) * 100, 2);
  ELSE
    v_current_asset := v_open_market_value;
    v_total_return_pct := 0;
  END IF;

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN ROUND((winning_trades::numeric / total_trades) * 100, 2) ELSE 0 END,
    'cumulative_return', ROUND(cumulative_ret, 2),
    'avg_pnl', ROUND(avg_pnl, 2),
    'max_drawdown', ROUND(max_dd, 2),
    'profit_factor', CASE WHEN loss_sum > 0 THEN ROUND(profit_sum / loss_sum, 2) ELSE CASE WHEN profit_sum > 0 THEN 999.99 ELSE 0 END END,
    'avg_hold_days', ROUND(avg_hold, 1),
    'total_pnl', ROUND(cumulative_ret, 2),
    'return_1y', ROUND(return_1y, 2),
    'current_asset', ROUND(v_current_asset, 0),
    'starting_capital', ROUND(v_starting_capital, 0),
    'realized_pnl_amount', ROUND(v_realized_amount, 0),
    'unrealized_pnl_amount', ROUND(v_unrealized_amount, 0),
    'total_return_pct', v_total_return_pct
  );

  RETURN result;
END;
$$;