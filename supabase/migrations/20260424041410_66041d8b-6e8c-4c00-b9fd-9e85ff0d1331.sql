-- Create trigger function to prevent manual updates of backtest KPI columns
CREATE OR REPLACE FUNCTION public.protect_backtest_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Force these columns to retain their original values regardless of who updates
  -- Backtest KPIs must be system-calculated from trade_records, never manually edited
  NEW.backtest_1y_return := OLD.backtest_1y_return;
  NEW.backtest_max_drawdown := OLD.backtest_max_drawdown;
  NEW.backtest_annual_return := OLD.backtest_annual_return;
  RETURN NEW;
END;
$$;

-- Attach trigger to experts table (BEFORE UPDATE so we silently override the values)
DROP TRIGGER IF EXISTS protect_experts_backtest_fields ON public.experts;
CREATE TRIGGER protect_experts_backtest_fields
  BEFORE UPDATE ON public.experts
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_backtest_fields();