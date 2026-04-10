
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
  running_sum_1y numeric := 0;
  one_year_ago timestamp with time zone := NOW() - INTERVAL '1 year';
  return_1y numeric;
  v_current_asset numeric := 0;
BEGIN
  -- Closed/stopped trades stats
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

  -- Max drawdown
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

  -- 1-year return
  SELECT COALESCE(SUM(pnl_percent), 0)
  INTO return_1y
  FROM public.trade_records
  WHERE expert_id = _expert_id
    AND status IN ('closed', 'stopped')
    AND pnl_percent IS NOT NULL
    AND exit_date >= one_year_ago;

  max_dd := worst_dd;

  -- Current asset: sum of open positions market value (quantity * 1000 * current_price)
  SELECT COALESCE(SUM(
    tr.quantity * 1000 * COALESCE(cp.price, tr.current_price, tr.entry_price, 0)
  ), 0)
  INTO v_current_asset
  FROM public.trade_records tr
  LEFT JOIN public.current_prices cp ON cp.symbol = SPLIT_PART(tr.instrument, ' ', 1)
  WHERE tr.expert_id = _expert_id
    AND tr.status = 'open';

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
    'current_asset', ROUND(v_current_asset, 0)
  );

  RETURN result;
END;
$$;
