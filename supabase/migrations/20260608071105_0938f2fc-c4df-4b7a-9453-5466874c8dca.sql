
-- R1: strip query string from referrer URLs to avoid storing tokens / session IDs
CREATE OR REPLACE FUNCTION public.strip_referrer_query(ref text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN ref IS NULL THEN NULL
    WHEN position('?' IN ref) > 0 THEN substring(ref FROM 1 FOR position('?' IN ref) - 1)
    ELSE ref
  END;
$$;

CREATE OR REPLACE FUNCTION public.traffic_visits_sanitize_referrer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.first_referrer := public.strip_referrer_query(NEW.first_referrer);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_traffic_visits_sanitize_referrer ON public.traffic_visits;
CREATE TRIGGER trg_traffic_visits_sanitize_referrer
  BEFORE INSERT OR UPDATE OF first_referrer ON public.traffic_visits
  FOR EACH ROW EXECUTE FUNCTION public.traffic_visits_sanitize_referrer();

-- One-shot backfill: strip query string from historical rows
UPDATE public.traffic_visits
   SET first_referrer = public.strip_referrer_query(first_referrer)
 WHERE first_referrer IS NOT NULL
   AND position('?' IN first_referrer) > 0;
