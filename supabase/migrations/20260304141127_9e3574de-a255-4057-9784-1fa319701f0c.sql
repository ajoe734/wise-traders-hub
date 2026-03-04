
ALTER TABLE public.experts
  ADD COLUMN backtest_1y_return numeric,
  ADD COLUMN backtest_max_drawdown numeric,
  ADD COLUMN backtest_annual_return numeric;
