-- H1 — Taiwan market master. Strictly new objects; stock_names is untouched.

CREATE TABLE IF NOT EXISTS public.tw_market_symbols (
  market            text        NOT NULL CHECK (market IN ('listed','otc')),
  symbol            text        NOT NULL,
  name              text        NOT NULL DEFAULT '',
  instrument_class  text        NOT NULL DEFAULT 'unknown'
                    CHECK (instrument_class IN ('common','etf','etf_leveraged','warrant','emerging','unknown')),
  eligibility       boolean     NOT NULL DEFAULT false,
  source            text        NOT NULL DEFAULT 'twse_openapi',
  last_seen_on      date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, symbol)
);

CREATE INDEX IF NOT EXISTS tw_market_symbols_eligible_idx
  ON public.tw_market_symbols (symbol) WHERE eligibility;

GRANT ALL ON public.tw_market_symbols TO service_role;
ALTER TABLE public.tw_market_symbols ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated grants: the master is read through server-side code only.
DROP POLICY IF EXISTS tw_market_symbols_admin_read ON public.tw_market_symbols;
CREATE POLICY tw_market_symbols_admin_read ON public.tw_market_symbols
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.tw_market_symbols_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS tw_market_symbols_touch_trg ON public.tw_market_symbols;
CREATE TRIGGER tw_market_symbols_touch_trg BEFORE UPDATE ON public.tw_market_symbols
  FOR EACH ROW EXECUTE FUNCTION public.tw_market_symbols_touch();

-- Idempotent upsert used by the (not yet deployed) tw-market-master-sync worker.
CREATE OR REPLACE FUNCTION public.upsert_tw_market_symbols(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.tw_market_symbols AS t (market, symbol, name, instrument_class, eligibility, source, last_seen_on)
  SELECT r.market, upper(btrim(r.symbol)), coalesce(r.name,''), coalesce(r.instrument_class,'unknown'),
         coalesce(r.eligibility, false), coalesce(r.source,'twse_openapi'), coalesce(r.last_seen_on, current_date)
  FROM jsonb_to_recordset(p_rows) AS r(market text, symbol text, name text, instrument_class text,
                                       eligibility boolean, source text, last_seen_on date)
  WHERE r.market IN ('listed','otc') AND btrim(coalesce(r.symbol,'')) <> ''
  ON CONFLICT (market, symbol) DO UPDATE
    SET name = EXCLUDED.name,
        instrument_class = EXCLUDED.instrument_class,
        eligibility = EXCLUDED.eligibility,
        source = EXCLUDED.source,
        last_seen_on = greatest(t.last_seen_on, EXCLUDED.last_seen_on);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.upsert_tw_market_symbols(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_tw_market_symbols(jsonb) TO service_role;
