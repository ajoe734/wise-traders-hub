
CREATE TABLE public.price_parity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  market text NOT NULL,
  db_price numeric,
  cache_price numeric,
  diff_pct numeric NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.price_parity_events TO authenticated;
GRANT ALL ON public.price_parity_events TO service_role;

ALTER TABLE public.price_parity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own parity events"
  ON public.price_parity_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "admins read parity events"
  ON public.price_parity_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

CREATE INDEX idx_price_parity_events_created ON public.price_parity_events (created_at DESC);
CREATE INDEX idx_price_parity_events_symbol ON public.price_parity_events (symbol, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_price_parity_summary(_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT * FROM public.price_parity_events
    WHERE created_at >= now() - make_interval(days => GREATEST(_days, 1))
      AND public.has_role(auth.uid(), 'company_admin')
  ),
  totals AS (
    SELECT
      count(*)::int AS events,
      count(DISTINCT symbol)::int AS symbols,
      round(avg(diff_pct)::numeric, 3) AS avg_diff_pct,
      round(max(diff_pct)::numeric, 3) AS max_diff_pct
    FROM scoped
  ),
  top AS (
    SELECT symbol, market,
           count(*)::int AS hits,
           round(avg(diff_pct)::numeric, 3) AS avg_diff_pct,
           round(max(diff_pct)::numeric, 3) AS max_diff_pct,
           max(created_at) AS last_seen
    FROM scoped
    GROUP BY symbol, market
    ORDER BY count(*) DESC, max(diff_pct) DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'totals', COALESCE((SELECT to_jsonb(t) FROM totals t), '{}'::jsonb),
    'top', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM top x), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_price_parity_summary(int) TO authenticated;
