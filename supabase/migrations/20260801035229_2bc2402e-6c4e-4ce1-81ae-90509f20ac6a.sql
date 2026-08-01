DROP FUNCTION IF EXISTS public.tw_detect_market_holidays(date, date);

CREATE OR REPLACE FUNCTION public.tw_detect_market_holidays(
  _from date DEFAULT (CURRENT_DATE - 30),
  _to   date DEFAULT CURRENT_DATE
)
RETURNS TABLE(holiday_date date, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date;
  has_before boolean;
  has_after  boolean;
  ins integer;
BEGIN
  FOR d IN
    SELECT g::date
    FROM generate_series(_from, LEAST(_to, CURRENT_DATE - 1), '1 day'::interval) g
    WHERE EXTRACT(DOW FROM g) NOT IN (0, 6)
      AND NOT EXISTS (SELECT 1 FROM public.tw_market_holidays h WHERE h.trade_date = g::date)
  LOOP
    IF EXISTS (SELECT 1 FROM public.tw_bsr_daily b WHERE b.trade_date = d)
       OR EXISTS (SELECT 1 FROM public.tw_institutional_daily i WHERE i.trade_date = d) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.tw_institutional_daily i
      WHERE i.trade_date < d AND i.trade_date >= d - 10
    ) OR EXISTS (
      SELECT 1 FROM public.tw_bsr_daily b
      WHERE b.trade_date < d AND b.trade_date >= d - 10
    ) INTO has_before;

    SELECT EXISTS (
      SELECT 1 FROM public.tw_institutional_daily i
      WHERE i.trade_date > d AND i.trade_date <= d + 10
    ) OR EXISTS (
      SELECT 1 FROM public.tw_bsr_daily b
      WHERE b.trade_date > d AND b.trade_date <= d + 10
    ) INTO has_after;

    IF has_before AND has_after THEN
      INSERT INTO public.tw_market_holidays (trade_date, name, source, note)
      VALUES (d, '自動偵測休市', 'auto', 'zero market-wide rows with data on both sides')
      ON CONFLICT (trade_date) DO NOTHING;
      GET DIAGNOSTICS ins = ROW_COUNT;
      holiday_date := d;
      was_inserted := COALESCE(ins, 0) > 0;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;