CREATE TABLE IF NOT EXISTS public.tw_market_holidays (
  trade_date  date PRIMARY KEY,
  name        text,
  source      text NOT NULL DEFAULT 'manual',
  detected_at timestamptz NOT NULL DEFAULT now(),
  note        text
);

GRANT SELECT ON public.tw_market_holidays TO authenticated;
GRANT SELECT ON public.tw_market_holidays TO anon;
GRANT ALL ON public.tw_market_holidays TO service_role;

ALTER TABLE public.tw_market_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "holidays readable by everyone" ON public.tw_market_holidays;
CREATE POLICY "holidays readable by everyone"
ON public.tw_market_holidays FOR SELECT
USING (true);

DROP POLICY IF EXISTS "admins manage holidays" ON public.tw_market_holidays;
CREATE POLICY "admins manage holidays"
ON public.tw_market_holidays FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'company_admin'))
WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

INSERT INTO public.tw_market_holidays (trade_date, name, source) VALUES
  ('2025-01-01','元旦','seed'),
  ('2025-01-23','春節休市','seed'),('2025-01-24','春節休市','seed'),
  ('2025-01-27','春節休市','seed'),('2025-01-28','春節休市','seed'),
  ('2025-01-29','春節休市','seed'),('2025-01-30','春節休市','seed'),
  ('2025-01-31','春節休市','seed'),
  ('2025-02-28','和平紀念日','seed'),
  ('2025-04-03','兒童節連假','seed'),('2025-04-04','兒童節清明','seed'),
  ('2025-05-01','勞動節','seed'),
  ('2025-05-30','端午連假','seed'),
  ('2025-10-06','中秋節','seed'),
  ('2025-10-10','國慶日','seed'),
  ('2026-01-01','元旦','seed'),('2026-01-02','元旦連假','seed'),
  ('2026-02-16','春節休市','seed'),('2026-02-17','春節休市','seed'),
  ('2026-02-18','春節休市','seed'),('2026-02-19','春節休市','seed'),
  ('2026-02-20','春節休市','seed'),
  ('2026-02-27','和平紀念日補假','seed'),
  ('2026-04-03','兒童節補假','seed'),('2026-04-06','清明補假','seed'),
  ('2026-05-01','勞動節','seed'),
  ('2026-06-19','端午節','seed'),
  ('2026-09-25','中秋節','seed'),
  ('2026-10-09','國慶補假','seed'),
  ('2026-10-26','光復節補假','seed'),
  ('2026-12-25','行憲紀念日','seed')
ON CONFLICT (trade_date) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_tw_trading_day(_d date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXTRACT(DOW FROM _d) NOT IN (0, 6)
     AND NOT EXISTS (SELECT 1 FROM public.tw_market_holidays h WHERE h.trade_date = _d);
$$;

CREATE OR REPLACE FUNCTION public.tw_trading_days(_from date, _to date)
RETURNS SETOF date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d::date
  FROM generate_series(_from, _to, '1 day'::interval) d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    AND NOT EXISTS (SELECT 1 FROM public.tw_market_holidays h WHERE h.trade_date = d::date);
$$;

CREATE OR REPLACE FUNCTION public.tw_detect_market_holidays(
  _from date DEFAULT (CURRENT_DATE - 30),
  _to   date DEFAULT CURRENT_DATE
)
RETURNS TABLE(trade_date date, inserted boolean)
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
      trade_date := d; inserted := COALESCE(ins, 0) > 0;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.tw_missing_trading_days(
  _from date DEFAULT (CURRENT_DATE - 20),
  _to   date DEFAULT CURRENT_DATE
)
RETURNS TABLE(trade_date date, bsr_rows bigint, inst_rows bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT td AS trade_date,
         (SELECT count(*) FROM public.tw_bsr_daily b WHERE b.trade_date = td) AS bsr_rows,
         (SELECT count(*) FROM public.tw_institutional_daily i WHERE i.trade_date = td) AS inst_rows
  FROM public.tw_trading_days(_from, _to) td
  WHERE (SELECT count(*) FROM public.tw_bsr_daily b WHERE b.trade_date = td) = 0
     OR (SELECT count(*) FROM public.tw_institutional_daily i WHERE i.trade_date = td) = 0
  ORDER BY td;
$$;

CREATE OR REPLACE FUNCTION public.detect_chip_gap_jobs(
  _target_date date DEFAULT CURRENT_DATE,
  _lookback_days integer DEFAULT 60,
  _max_jobs integer DEFAULT 5000
)
RETURNS TABLE(stock_id text, start_date date, end_date date, gap_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH universe AS (
    SELECT DISTINCT (regexp_match(split_part(tr.instrument, ' ', 1), '^([1-9][0-9]{3})'))[1] AS symbol
    FROM public.trade_records tr
    WHERE tr.exit_date IS NULL
      AND COALESCE(upper(tr.market), 'TW') IN ('TW','TWSE','TPEX')
      AND split_part(tr.instrument, ' ', 1) ~ '^[1-9][0-9]{3}(\s|$)'
    UNION
    SELECT DISTINCT (regexp_match(split_part(es.instrument, ' ', 1), '^([1-9][0-9]{3})'))[1] AS symbol
    FROM public.expert_signals es
    WHERE es.published_at IS NOT NULL
      AND COALESCE(upper(es.market), 'TW') IN ('TW','TWSE','TPEX')
      AND split_part(es.instrument, ' ', 1) ~ '^[1-9][0-9]{3}(\s|$)'
  ),
  trade_dates AS (
    SELECT td AS trade_date
    FROM public.tw_trading_days(_target_date - (_lookback_days - 1), _target_date) td
  ),
  expected AS (
    SELECT u.symbol, td.trade_date FROM universe u CROSS JOIN trade_dates td
  ),
  existing AS (
    SELECT DISTINCT bd.stock_id, bd.trade_date
    FROM public.tw_bsr_daily bd
    WHERE bd.trade_date >= _target_date - (_lookback_days - 1)
      AND bd.trade_date <= _target_date
  ),
  missing AS (
    SELECT e.symbol, e.trade_date
    FROM expected e
    LEFT JOIN existing ex ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
    WHERE ex.stock_id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::INTEGER AS cnt
    FROM missing m GROUP BY m.symbol
  )
  SELECT g.symbol, g.min_date, g.max_date, g.cnt
  FROM gaps g ORDER BY g.cnt DESC LIMIT _max_jobs;
$function$;

CREATE OR REPLACE FUNCTION public.detect_institutional_gap_jobs(
  _target_date date DEFAULT CURRENT_DATE,
  _lookback_days integer DEFAULT 60,
  _max_jobs integer DEFAULT 5000
)
RETURNS TABLE(stock_id text, start_date date, end_date date, gap_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH universe AS (
    SELECT DISTINCT (regexp_match(split_part(tr.instrument, ' ', 1), '^([1-9][0-9]{3})'))[1] AS symbol
    FROM public.trade_records tr
    WHERE tr.exit_date IS NULL
      AND COALESCE(upper(tr.market), 'TW') IN ('TW','TWSE','TPEX')
      AND split_part(tr.instrument, ' ', 1) ~ '^[1-9][0-9]{3}(\s|$)'
    UNION
    SELECT DISTINCT (regexp_match(split_part(es.instrument, ' ', 1), '^([1-9][0-9]{3})'))[1] AS symbol
    FROM public.expert_signals es
    WHERE es.published_at IS NOT NULL
      AND COALESCE(upper(es.market), 'TW') IN ('TW','TWSE','TPEX')
      AND split_part(es.instrument, ' ', 1) ~ '^[1-9][0-9]{3}(\s|$)'
  ),
  trade_dates AS (
    SELECT td AS trade_date
    FROM public.tw_trading_days(_target_date - (_lookback_days - 1), _target_date) td
  ),
  expected AS (
    SELECT u.symbol, td.trade_date FROM universe u CROSS JOIN trade_dates td
  ),
  existing AS (
    SELECT DISTINCT id.stock_id, id.trade_date
    FROM public.tw_institutional_daily id
    WHERE id.trade_date >= _target_date - (_lookback_days - 1)
      AND id.trade_date <= _target_date
  ),
  missing AS (
    SELECT e.symbol, e.trade_date
    FROM expected e
    LEFT JOIN existing ex ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
    WHERE ex.stock_id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::INTEGER AS cnt
    FROM missing m GROUP BY m.symbol
  )
  SELECT g.symbol, g.min_date, g.max_date, g.cnt
  FROM gaps g ORDER BY g.cnt DESC LIMIT _max_jobs;
$function$;