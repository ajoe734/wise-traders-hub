CREATE TABLE public.valuation_filing_versions (
 symbol text PRIMARY KEY,
 expected_period date,
 latest_period date,
 statements jsonb,
 balance_sheet jsonb,
 prices jsonb,
 version text,
 source text,
 detected_at timestamptz,
 fetched_at timestamptz,
 last_attempt_at timestamptz,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','failed')),
 reason text
);
GRANT ALL ON public.valuation_filing_versions TO service_role;
ALTER TABLE public.valuation_filing_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Backend owns filing versions" ON public.valuation_filing_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX valuation_filing_versions_pending ON public.valuation_filing_versions (state, last_attempt_at);
COMMENT ON TABLE public.valuation_filing_versions IS 'Public financial filing versions, backend-only. A pending new filing never replaces an earlier complete committed version.';