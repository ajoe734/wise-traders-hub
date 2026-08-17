-- H2 — privacy-safe symbol demand registry.
-- Depends on H1 (tw_market_symbols) for the eligibility whitelist.
-- No user_id / quantity / cost is ever stored. PK dedupes across all users.

CREATE TABLE IF NOT EXISTS public.symbol_demand_registry (
  market             text        NOT NULL CHECK (market IN ('listed','otc')),
  symbol             text        NOT NULL,
  first_requested_at timestamptz NOT NULL DEFAULT now(),
  last_requested_at  timestamptz NOT NULL DEFAULT now(),
  request_count      integer     NOT NULL DEFAULT 1 CHECK (request_count >= 0 AND request_count <= 10000),
  source_class       text        NOT NULL DEFAULT 'drawer'
                     CHECK (source_class IN ('holding','drawer','batch','demo')),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, symbol)
);

CREATE INDEX IF NOT EXISTS symbol_demand_registry_fastlane_idx
  ON public.symbol_demand_registry (request_count DESC, last_requested_at DESC);

GRANT ALL ON public.symbol_demand_registry TO service_role;
ALTER TABLE public.symbol_demand_registry ENABLE ROW LEVEL SECURITY;
-- deliberately no policy for anon/authenticated: RLS denies everything.

-- The only writer. service_role only; the Edge function (rate limited, schema
-- validated) is the sole caller. Callers cannot choose priority or counts.
CREATE OR REPLACE FUNCTION public.register_symbol_demand(p_symbols text[], p_source_class text DEFAULT 'drawer')
RETURNS TABLE (symbol text, market text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_src text := CASE WHEN p_source_class IN ('holding','drawer','batch','demo') THEN p_source_class ELSE 'drawer' END;
BEGIN
  IF p_symbols IS NULL OR array_length(p_symbols, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_symbols, 1) > 30 THEN
    RAISE EXCEPTION 'too_many_symbols' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH input AS (
    SELECT DISTINCT upper(btrim(s)) AS sym FROM unnest(p_symbols) AS s
    WHERE btrim(coalesce(s,'')) <> ''
  ), matched AS (
    SELECT i.sym, m.market
    FROM input i
    LEFT JOIN public.tw_market_symbols m ON m.symbol = i.sym AND m.eligibility
  ), written AS (
    INSERT INTO public.symbol_demand_registry AS d (market, symbol, source_class)
    SELECT mt.market, mt.sym, v_src FROM matched mt WHERE mt.market IS NOT NULL
    ON CONFLICT (market, symbol) DO UPDATE
      SET last_requested_at = now(),
          updated_at = now(),
          request_count = least(d.request_count + 1, 10000)
    RETURNING d.symbol, d.market
  )
  SELECT mt.sym, mt.market, CASE WHEN mt.market IS NULL THEN 'unsupported' ELSE 'registered' END
  FROM matched mt
  LEFT JOIN written w ON w.symbol = mt.sym;
END $$;

REVOKE ALL ON FUNCTION public.register_symbol_demand(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_symbol_demand(text[], text) TO service_role;

-- Daily decay so stale demand cannot pin the fast lane forever.
CREATE OR REPLACE FUNCTION public.decay_symbol_demand()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.symbol_demand_registry
     SET request_count = greatest(0, floor(request_count * 0.9)::int), updated_at = now()
   WHERE last_requested_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.symbol_demand_registry
   WHERE last_requested_at < now() - interval '30 days' AND source_class = 'drawer';
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.decay_symbol_demand() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decay_symbol_demand() TO service_role;
