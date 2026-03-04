
-- 1. Fix calculate_expert_performance: compound returns + peak-to-trough drawdown
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  total_trades integer;
  winning_trades integer;
  cumulative_ret numeric;
  max_dd numeric;
  avg_hold numeric;
  profit_sum numeric;
  loss_sum numeric;
  rec record;
  peak numeric := 1;
  equity numeric := 1;
  worst_dd numeric := 0;
BEGIN
  -- Basic aggregates
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pnl_percent > 0),
    COALESCE(AVG(EXTRACT(EPOCH FROM (exit_date - entry_date)) / 86400), 0),
    COALESCE(SUM(pnl_percent) FILTER (WHERE pnl_percent > 0), 0),
    COALESCE(ABS(SUM(pnl_percent) FILTER (WHERE pnl_percent < 0)), 0)
  INTO total_trades, winning_trades, avg_hold, profit_sum, loss_sum
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed', 'stopped');

  -- Compound return & peak-to-trough drawdown
  FOR rec IN
    SELECT pnl_percent
    FROM public.trade_records
    WHERE expert_id = _expert_id
      AND status IN ('closed', 'stopped')
      AND pnl_percent IS NOT NULL
    ORDER BY exit_date ASC NULLS LAST, created_at ASC
  LOOP
    equity := equity * (1 + rec.pnl_percent / 100.0);
    IF equity > peak THEN
      peak := equity;
    END IF;
    IF peak > 0 AND ((peak - equity) / peak) > worst_dd THEN
      worst_dd := (peak - equity) / peak;
    END IF;
  END LOOP;

  cumulative_ret := ROUND((equity - 1) * 100, 2);
  max_dd := ROUND(worst_dd * 100, 2);

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN ROUND((winning_trades::numeric / total_trades) * 100, 1) ELSE 0 END,
    'cumulative_return', cumulative_ret,
    'max_drawdown', max_dd,
    'profit_factor', CASE WHEN loss_sum > 0 THEN ROUND(profit_sum / loss_sum, 2) ELSE CASE WHEN profit_sum > 0 THEN 999.99 ELSE 0 END END,
    'avg_hold_days', ROUND(avg_hold, 1),
    'total_pnl', cumulative_ret
  );

  RETURN result;
END;
$function$;

-- 2. Create trigger to auto-close trades when signal is taken down
CREATE OR REPLACE FUNCTION public.handle_signal_takedown()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- When a signal is taken down, close any open trades linked to it
  IF NEW.status = 'taken_down' AND OLD.status = 'published' THEN
    UPDATE public.trade_records
    SET status = 'stopped'::trade_status,
        exit_date = NOW(),
        exit_price = current_price
    WHERE signal_id = NEW.id
      AND status = 'open';

    -- Also close open trades matching instrument+expert without signal_id
    UPDATE public.trade_records
    SET status = 'stopped'::trade_status,
        exit_date = NOW(),
        exit_price = current_price
    WHERE expert_id = NEW.expert_id
      AND instrument = NEW.instrument
      AND status = 'open'
      AND signal_id IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Attach triggers
DROP TRIGGER IF EXISTS on_signal_insert_or_update ON public.expert_signals;
CREATE TRIGGER on_signal_insert_or_update
  AFTER INSERT OR UPDATE ON public.expert_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_signal_trade();

DROP TRIGGER IF EXISTS on_signal_takedown ON public.expert_signals;
CREATE TRIGGER on_signal_takedown
  AFTER UPDATE ON public.expert_signals
  FOR EACH ROW
  WHEN (NEW.status = 'taken_down' AND OLD.status = 'published')
  EXECUTE FUNCTION public.handle_signal_takedown();
