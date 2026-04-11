
-- 1. daily_price_snapshots
CREATE TABLE public.daily_price_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  trade_date date NOT NULL,
  close_price numeric,
  yesterday_close numeric,
  change_percent numeric,
  is_limit_up boolean NOT NULL DEFAULT false,
  limit_up_price numeric,
  volume integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, trade_date)
);

ALTER TABLE public.daily_price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view snapshots"
  ON public.daily_price_snapshots FOR SELECT
  TO public USING (true);

CREATE INDEX idx_snapshots_date ON public.daily_price_snapshots(trade_date);
CREATE INDEX idx_snapshots_symbol_date ON public.daily_price_snapshots(symbol, trade_date);
CREATE INDEX idx_snapshots_limit_up ON public.daily_price_snapshots(is_limit_up, trade_date) WHERE is_limit_up = true;

-- 2. expert_limit_up_hits
CREATE TABLE public.expert_limit_up_hits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  instrument text,
  trade_date date NOT NULL,
  close_price numeric,
  entry_price numeric,
  trade_record_id uuid REFERENCES public.trade_records(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(expert_id, symbol, trade_date)
);

ALTER TABLE public.expert_limit_up_hits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view limit up hits"
  ON public.expert_limit_up_hits FOR SELECT
  TO public USING (true);

CREATE INDEX idx_hits_expert ON public.expert_limit_up_hits(expert_id);
CREATE INDEX idx_hits_date ON public.expert_limit_up_hits(trade_date);
CREATE INDEX idx_hits_expert_date ON public.expert_limit_up_hits(expert_id, trade_date);

-- 3. Leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_weekly_limit_up_leaderboard(
  _start_date date DEFAULT (date_trunc('week', now() AT TIME ZONE 'Asia/Taipei'))::date,
  _end_date date DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date
)
RETURNS TABLE(
  expert_id uuid,
  expert_name text,
  expert_slug text,
  avatar_url text,
  limit_up_count bigint,
  win_rate numeric,
  weekly_return numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hits AS (
    SELECT h.expert_id, COUNT(*) AS cnt
    FROM expert_limit_up_hits h
    WHERE h.trade_date BETWEEN _start_date AND _end_date
    GROUP BY h.expert_id
  ),
  perf AS (
    SELECT tr.expert_id,
      COUNT(*) FILTER (WHERE tr.status IN ('closed','stopped')) AS total_closed,
      COUNT(*) FILTER (WHERE tr.status IN ('closed','stopped') AND tr.pnl_percent > 0) AS wins,
      COALESCE(SUM(tr.pnl_percent) FILTER (WHERE tr.status IN ('closed','stopped') AND tr.exit_date >= _start_date::timestamptz), 0) AS week_ret
    FROM trade_records tr
    WHERE tr.expert_id IN (SELECT expert_id FROM hits)
    GROUP BY tr.expert_id
  )
  SELECT
    e.id AS expert_id,
    e.name AS expert_name,
    e.slug AS expert_slug,
    e.avatar_url,
    COALESCE(h.cnt, 0) AS limit_up_count,
    CASE WHEN COALESCE(p.total_closed, 0) > 0
      THEN ROUND((p.wins::numeric / p.total_closed) * 100, 1)
      ELSE 0
    END AS win_rate,
    ROUND(COALESCE(p.week_ret, 0), 1) AS weekly_return
  FROM hits h
  JOIN experts e ON e.id = h.expert_id AND e.status = 'active'
  LEFT JOIN perf p ON p.expert_id = h.expert_id
  ORDER BY h.cnt DESC, weekly_return DESC
  LIMIT 10;
$$;
