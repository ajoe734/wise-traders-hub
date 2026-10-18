CREATE TABLE public.tw_price_history (
  symbol text NOT NULL,
  trade_date date NOT NULL,
  open numeric, high numeric, low numeric,
  close numeric NOT NULL,
  volume bigint,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, trade_date)
);
GRANT ALL ON public.tw_price_history TO service_role;
ALTER TABLE public.tw_price_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tw_month_revenue (
  symbol text NOT NULL,
  revenue_year int NOT NULL,
  revenue_month int NOT NULL,
  revenue numeric NOT NULL,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, revenue_year, revenue_month)
);
GRANT ALL ON public.tw_month_revenue TO service_role;
ALTER TABLE public.tw_month_revenue ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.market_data_requests (
  symbol text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending',
  reason text
);
GRANT ALL ON public.market_data_requests TO service_role;
ALTER TABLE public.market_data_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company admins read price history" ON public.tw_price_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "company admins read month revenue" ON public.tw_month_revenue FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));
CREATE POLICY "company admins read data requests" ON public.market_data_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'company_admin'));
GRANT SELECT ON public.tw_price_history, public.tw_month_revenue, public.market_data_requests TO authenticated;