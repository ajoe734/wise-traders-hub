DROP FUNCTION IF EXISTS public.rebuild_bsr_rollup(text, date);
DROP FUNCTION IF EXISTS public.rebuild_bsr_rollup_range(date, date, integer);

SELECT public.rebuild_bsr_rollup(
  (SELECT MAX(trade_date) FROM public.tw_bsr_daily), NULL::text[], 2000);