
CREATE OR REPLACE FUNCTION public.calculate_expert_performance(_expert_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  rec record;
  peak numeric := 1;
  equity numeric := 1;
  worst_dd numeric := 0;
  equity_1y numeric := 1;
  one_year_ago timestamp with time zone := NOW() - INTERVAL '1 year';
  return_1y numeric;
BEGIN
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

  FOR rec IN
    SELECT pnl_percent, exit_date
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

  FOR rec IN
    SELECT pnl_percent
    FROM public.trade_records
    WHERE expert_id = _expert_id
      AND status IN ('closed', 'stopped')
      AND pnl_percent IS NOT NULL
      AND exit_date >= one_year_ago
    ORDER BY exit_date ASC NULLS LAST, created_at ASC
  LOOP
    equity_1y := equity_1y * (1 + rec.pnl_percent / 100.0);
  END LOOP;

  cumulative_ret := (equity - 1) * 100;
  max_dd := worst_dd * 100;
  return_1y := (equity_1y - 1) * 100;

  result := jsonb_build_object(
    'total_trades', total_trades,
    'win_rate', CASE WHEN total_trades > 0 THEN (winning_trades::numeric / total_trades) * 100 ELSE 0 END,
    'cumulative_return', cumulative_ret,
    'max_drawdown', max_dd,
    'profit_factor', CASE WHEN loss_sum > 0 THEN profit_sum / loss_sum ELSE CASE WHEN profit_sum > 0 THEN 999.99 ELSE 0 END END,
    'avg_hold_days', avg_hold,
    'total_pnl', cumulative_ret,
    'return_1y', return_1y
  );

  RETURN result;
END;
$$;
