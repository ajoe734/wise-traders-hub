-- ============================================================
-- P5 / Gap-Driven Opportunistic Backfill
-- 通用回填佇列 + 全市場基本面表 + 多源 worker 入口
-- ============================================================

CREATE TABLE IF NOT EXISTS public.backfill_job_queue (
  id             BIGSERIAL PRIMARY KEY,
  dataset        TEXT NOT NULL CHECK (dataset IN ('chip_fact','institutional_daily','fundamentals')),
  stock_id       TEXT NOT NULL,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  priority_score INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped','cancelled')),
  source_hint    TEXT NOT NULL DEFAULT 'finmind',
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  next_run_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error     TEXT,
  payload        JSONB,
  fulfilled_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backfill_job_status_next
  ON public.backfill_job_queue (status, next_run_at, priority_score DESC, id);
CREATE INDEX IF NOT EXISTS idx_backfill_job_dataset_status
  ON public.backfill_job_queue (dataset, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_backfill_job_active_unique
  ON public.backfill_job_queue (dataset, stock_id, start_date, end_date, source_hint)
  WHERE status IN ('pending','running');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backfill_job_queue TO authenticated;
GRANT ALL ON public.backfill_job_queue TO service_role;

ALTER TABLE public.backfill_job_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backfill_job_admin_all" ON public.backfill_job_queue;
CREATE POLICY "backfill_job_admin_all"
  ON public.backfill_job_queue FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

DROP POLICY IF EXISTS "backfill_job_service_all" ON public.backfill_job_queue;
CREATE POLICY "backfill_job_service_all"
  ON public.backfill_job_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.stock_fundamentals (
  id          BIGSERIAL PRIMARY KEY,
  stock_id    TEXT NOT NULL,
  report_date DATE NOT NULL,
  dataset     TEXT NOT NULL CHECK (dataset IN (
    'financial_statements','balance_sheet','cash_flow','dividend',
    'institutional_investors','shareholding','revenue','monthly_revenue'
  )),
  data        JSONB NOT NULL,
  source      TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, report_date, dataset)
);

CREATE INDEX IF NOT EXISTS idx_stock_fundamentals_lookup
  ON public.stock_fundamentals (stock_id, report_date DESC, dataset);
CREATE INDEX IF NOT EXISTS idx_stock_fundamentals_dataset_latest
  ON public.stock_fundamentals (stock_id, dataset, report_date DESC);

GRANT SELECT ON public.stock_fundamentals TO authenticated;
GRANT ALL ON public.stock_fundamentals TO service_role;

ALTER TABLE public.stock_fundamentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_fundamentals_admin_read" ON public.stock_fundamentals;
CREATE POLICY "stock_fundamentals_admin_read"
  ON public.stock_fundamentals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'company_admin'));

DROP POLICY IF EXISTS "stock_fundamentals_service_all" ON public.stock_fundamentals;
CREATE POLICY "stock_fundamentals_service_all"
  ON public.stock_fundamentals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.claim_backfill_jobs(
  _batch_size INTEGER DEFAULT 1,
  _max_priority_score INTEGER DEFAULT NULL
)
RETURNS TABLE(
  id BIGINT,
  dataset TEXT,
  stock_id TEXT,
  start_date DATE,
  end_date DATE,
  source_hint TEXT,
  payload JSONB,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts TIMESTAMPTZ := now();
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM public.backfill_job_queue q
    WHERE q.status = 'pending'
      AND q.next_run_at <= now_ts
      AND (_max_priority_score IS NULL OR q.priority_score <= _max_priority_score)
    ORDER BY q.priority_score DESC, q.next_run_at ASC, q.id ASC
    LIMIT _batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.backfill_job_queue q
  SET status = 'running',
      updated_at = now_ts,
      attempts = q.attempts + 1,
      last_error = NULL
  FROM claimed c
  WHERE q.id = c.id
  RETURNING q.id, q.dataset, q.stock_id, q.start_date, q.end_date, q.source_hint, q.payload, q.attempts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_backfill_jobs(INTEGER, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.backfill_job_set_done(
  _id BIGINT,
  _status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.backfill_job_queue
  SET status = _status,
      updated_at = now(),
      fulfilled_at = CASE WHEN _status IN ('done','skipped') THEN now() ELSE fulfilled_at END
  WHERE id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_job_set_done(BIGINT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.backfill_job_set_failed(
  _id BIGINT,
  _error TEXT,
  _retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.backfill_job_queue;
BEGIN
  SELECT * INTO job FROM public.backfill_job_queue WHERE id = _id;
  IF NOT FOUND THEN RETURN; END IF;

  IF job.attempts >= job.max_attempts THEN
    UPDATE public.backfill_job_queue
    SET status = 'failed',
        last_error = _error,
        updated_at = now()
    WHERE id = _id;
  ELSE
    UPDATE public.backfill_job_queue
    SET status = 'pending',
        last_error = _error,
        next_run_at = COALESCE(_retry_at, now() + (interval '1 minute' * (job.attempts + 1))),
        updated_at = now()
    WHERE id = _id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_job_set_failed(BIGINT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_backfill_jobs(
  _jobs JSONB
)
RETURNS TABLE(inserted INTEGER, skipped INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
  v_skipped INTEGER := 0;
  job RECORD;
BEGIN
  FOR job IN
    SELECT
      (j->>'dataset')::TEXT AS dataset,
      (j->>'stock_id')::TEXT AS stock_id,
      (j->>'start_date')::DATE AS start_date,
      (j->>'end_date')::DATE AS end_date,
      COALESCE((j->>'priority_score')::INTEGER, 0) AS priority_score,
      COALESCE((j->>'source_hint')::TEXT, 'finmind') AS source_hint,
      COALESCE((j->>'max_attempts')::INTEGER, 3) AS max_attempts,
      COALESCE(j->'payload', '{}'::JSONB) AS payload
    FROM jsonb_array_elements(_jobs) AS j
  LOOP
    INSERT INTO public.backfill_job_queue (
      dataset, stock_id, start_date, end_date, priority_score,
      source_hint, max_attempts, payload, status
    )
    VALUES (
      job.dataset, job.stock_id, job.start_date, job.end_date, job.priority_score,
      job.source_hint, job.max_attempts, job.payload, 'pending'
    )
    ON CONFLICT (dataset, stock_id, start_date, end_date, source_hint)
    WHERE status IN ('pending','running')
    DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_skipped;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_backfill_jobs(JSONB) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.detect_chip_gap_jobs(
  _target_date DATE DEFAULT CURRENT_DATE,
  _lookback_days INTEGER DEFAULT 60,
  _max_jobs INTEGER DEFAULT 5000
)
RETURNS TABLE(stock_id TEXT, start_date DATE, end_date DATE, gap_count INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT d::date AS trade_date
    FROM generate_series(_target_date - (_lookback_days - 1), _target_date, '1 day'::interval) d
    WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
  ),
  expected AS (
    SELECT u.symbol, td.trade_date
    FROM universe u
    CROSS JOIN trade_dates td
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
    LEFT JOIN existing ex
      ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
    WHERE ex.stock_id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::INTEGER AS cnt
    FROM missing m
    GROUP BY m.symbol
  )
  SELECT g.symbol, g.min_date, g.max_date, g.cnt
  FROM gaps g
  ORDER BY g.cnt DESC
  LIMIT _max_jobs;
$$;

GRANT EXECUTE ON FUNCTION public.detect_chip_gap_jobs(DATE, INTEGER, INTEGER) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.detect_institutional_gap_jobs(
  _target_date DATE DEFAULT CURRENT_DATE,
  _lookback_days INTEGER DEFAULT 60,
  _max_jobs INTEGER DEFAULT 5000
)
RETURNS TABLE(stock_id TEXT, start_date DATE, end_date DATE, gap_count INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT d::date AS trade_date
    FROM generate_series(_target_date - (_lookback_days - 1), _target_date, '1 day'::interval) d
    WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
  ),
  expected AS (
    SELECT u.symbol, td.trade_date
    FROM universe u
    CROSS JOIN trade_dates td
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
    LEFT JOIN existing ex
      ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
    WHERE ex.stock_id IS NULL
  ),
  gaps AS (
    SELECT m.symbol, MIN(m.trade_date) AS min_date, MAX(m.trade_date) AS max_date, COUNT(*)::INTEGER AS cnt
    FROM missing m
    GROUP BY m.symbol
  )
  SELECT g.symbol, g.min_date, g.max_date, g.cnt
  FROM gaps g
  ORDER BY g.cnt DESC
  LIMIT _max_jobs;
$$;

GRANT EXECUTE ON FUNCTION public.detect_institutional_gap_jobs(DATE, INTEGER, INTEGER) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.detect_fundamental_gap_jobs(
  _target_date DATE DEFAULT CURRENT_DATE,
  _max_jobs INTEGER DEFAULT 1000
)
RETURNS TABLE(stock_id TEXT, start_date DATE, end_date DATE, gap_count INTEGER, missing_datasets TEXT[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  recent_months AS (
    SELECT generate_series(1, 12) AS i
  ),
  expected_monthly AS (
    SELECT u.symbol,
           DATE_TRUNC('month', _target_date - (rm.i || ' months')::interval)::date AS report_month
    FROM universe u
    CROSS JOIN recent_months rm
  ),
  existing_monthly AS (
    SELECT DISTINCT stock_id, DATE_TRUNC('month', report_date)::date AS report_month
    FROM public.stock_fundamentals
    WHERE dataset = 'monthly_revenue'
      AND report_date >= _target_date - interval '12 months'
  ),
  missing_monthly AS (
    SELECT em.symbol, em.report_month
    FROM expected_monthly em
    LEFT JOIN existing_monthly exm
      ON exm.stock_id = em.symbol AND exm.report_month = em.report_month
    WHERE exm.stock_id IS NULL
  ),
  recent_quarters AS (
    SELECT generate_series(1, 4) * 3 AS months_back
  ),
  expected_quarterly AS (
    SELECT u.symbol,
           DATE_TRUNC('quarter', _target_date - (rq.months_back || ' months')::interval)::date AS report_quarter
    FROM universe u
    CROSS JOIN recent_quarters rq
  ),
  existing_quarterly AS (
    SELECT DISTINCT stock_id, DATE_TRUNC('quarter', report_date)::date AS report_quarter
    FROM public.stock_fundamentals
    WHERE dataset IN ('financial_statements','balance_sheet','cash_flow')
      AND report_date >= _target_date - interval '12 months'
  ),
  missing_quarterly AS (
    SELECT eq.symbol, eq.report_quarter
    FROM expected_quarterly eq
    LEFT JOIN existing_quarterly exq
      ON exq.stock_id = eq.symbol AND exq.report_quarter = eq.report_quarter
    WHERE exq.stock_id IS NULL
  ),
  all_missing AS (
    SELECT symbol, report_month AS period, 'monthly_revenue'::TEXT AS missing_dataset
    FROM missing_monthly
    UNION ALL
    SELECT symbol, report_quarter, 'financial_statements'::TEXT
    FROM missing_quarterly
  ),
  grouped AS (
    SELECT symbol,
           MIN(period) AS min_period,
           MAX(period) AS max_period,
           COUNT(*)::INTEGER AS cnt,
           array_agg(DISTINCT missing_dataset) AS missing_datasets
    FROM all_missing
    GROUP BY symbol
  )
  SELECT symbol, min_period, max_period, cnt, missing_datasets
  FROM grouped
  ORDER BY cnt DESC
  LIMIT _max_jobs;
$$;

GRANT EXECUTE ON FUNCTION public.detect_fundamental_gap_jobs(DATE, INTEGER) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.backfill_queue_stats()
RETURNS TABLE(
  dataset TEXT,
  pending BIGINT,
  running BIGINT,
  done BIGINT,
  failed BIGINT,
  skipped BIGINT,
  oldest_pending TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(j.dataset, 'total') AS dataset,
    SUM(CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN j.status = 'running' THEN 1 ELSE 0 END) AS running,
    SUM(CASE WHEN j.status = 'done' THEN 1 ELSE 0 END) AS done,
    SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN j.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
    MIN(CASE WHEN j.status = 'pending' THEN j.created_at ELSE NULL END) AS oldest_pending
  FROM public.backfill_job_queue j
  GROUP BY ROLLUP(j.dataset)
  ORDER BY dataset NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_queue_stats() TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.prune_backfill_job_queue()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.backfill_job_queue
  WHERE updated_at < now() - interval '30 days';
$$;

GRANT EXECUTE ON FUNCTION public.prune_backfill_job_queue() TO service_role;

DO $$ BEGIN PERFORM cron.unschedule('backfill-gap-orchestrator-sunday'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('backfill-gap-orchestrator-weeknight'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('backfill-worker-dispatch'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('prune-backfill-job-queue'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'backfill-gap-orchestrator-sunday',
  '0 10 * * 0',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/backfill-gap-orchestrator',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"run","max_scan_jobs":1000,"max_dispatch_jobs":300,"trigger_source":"cron-sunday"}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'backfill-gap-orchestrator-sunday', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'backfill-gap-orchestrator-weeknight',
  '0 18 * * 1-5',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/backfill-gap-orchestrator',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"run","max_scan_jobs":300,"max_dispatch_jobs":100,"trigger_source":"cron-weeknight"}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'backfill-gap-orchestrator-weeknight', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'backfill-worker-dispatch',
  '*/10 * * * *',
  $ct$
  WITH r AS (
    SELECT net.http_post(
      url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/backfill-worker',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYWNtcmdkamxlbmJpamNsbmdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyODcsImV4cCI6MjA4NzM5ODI4N30.tK-z5GHxqDycc9ArFkvhCPrMU2P7vd6q7CHUIq_0Yfo"}'::jsonb,
      body:='{"mode":"worker","batch_size":5,"trigger_source":"cron"}'::jsonb
    ) AS request_id
  )
  INSERT INTO public.cron_dispatch_log(jobname, request_id)
  SELECT 'backfill-worker-dispatch', request_id FROM r;
  $ct$
);

SELECT cron.schedule(
  'prune-backfill-job-queue',
  '17 4 * * *',
  $ct$ SELECT public.prune_backfill_job_queue(); $ct$
);

COMMENT ON TABLE public.backfill_job_queue IS 'P5: Gap-Driven 通用回填佇列，跨 chip_fact / institutional_daily / fundamentals';
COMMENT ON TABLE public.stock_fundamentals IS 'P5: 全市場基本面混合資料湖，以 (stock_id, report_date, dataset) 為唯一鍵';
