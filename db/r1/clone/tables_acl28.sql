-- R1-P clone: extra objects for the 28 ACL targets
-- generated read-only by db/r1/clone/extract_acl28_tables.py
SET client_min_messages=warning;
SET check_function_bodies=off;

-- TABLES
CREATE TABLE IF NOT EXISTS public.backfill_job_queue (
  id bigint DEFAULT nextval('backfill_job_queue_id_seq'::regclass) NOT NULL,
  dataset text NOT NULL,
  stock_id text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  priority_score integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  source_hint text DEFAULT 'finmind'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 3 NOT NULL,
  next_run_at timestamp with time zone DEFAULT now() NOT NULL,
  correlation_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_error text,
  payload jsonb,
  fulfilled_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.checkup_storage (
  key text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.function_run_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fn text NOT NULL,
  run_id text NOT NULL,
  level text DEFAULT 'info'::text NOT NULL,
  stage text,
  msg text,
  expert_id uuid,
  signal_id uuid,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS public.institutional_new_stock_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  stock_id text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  last_error text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.publish_batch_attempts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  market text NOT NULL,
  attempt_no integer DEFAULT 1 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL,
  status text DEFAULT 'pending_retry'::text NOT NULL,
  scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
  next_retry_at timestamp with time zone,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  run_id text,
  parent_attempt_id uuid,
  root_attempt_id uuid,
  error_message text,
  response jsonb,
  trigger_source text DEFAULT 'cron'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  level text DEFAULT 'warning'::text NOT NULL,
  title text NOT NULL,
  message text,
  metric_value numeric,
  threshold numeric,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  fired_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  notified_at timestamp with time zone,
  notify_error text
);
CREATE TABLE IF NOT EXISTS public.tw_chip_fact (
  id bigint DEFAULT nextval('tw_chip_fact_id_seq'::regclass) NOT NULL,
  stock_id text NOT NULL,
  trade_date date NOT NULL,
  broker_id text NOT NULL,
  broker_name text,
  source text NOT NULL,
  buy_shares bigint DEFAULT 0 NOT NULL,
  sell_shares bigint DEFAULT 0 NOT NULL,
  net_shares bigint,
  avg_buy_price numeric(12,4),
  avg_sell_price numeric(12,4),
  raw jsonb,
  ingested_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tw_institutional_daily (
  id bigint DEFAULT nextval('tw_institutional_daily_id_seq'::regclass) NOT NULL,
  stock_id text NOT NULL,
  trade_date date NOT NULL,
  foreign_net bigint DEFAULT 0 NOT NULL,
  trust_net bigint DEFAULT 0 NOT NULL,
  dealer_net bigint DEFAULT 0 NOT NULL,
  total_net bigint DEFAULT 0 NOT NULL,
  raw jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  source text DEFAULT 'unknown'::text NOT NULL
);

-- PRIMARY/UNIQUE CONSTRAINTS
ALTER TABLE public.backfill_job_queue ADD CONSTRAINT backfill_job_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.checkup_storage ADD CONSTRAINT checkup_storage_pkey PRIMARY KEY (user_id, key);
ALTER TABLE public.function_run_logs ADD CONSTRAINT function_run_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.institutional_new_stock_queue ADD CONSTRAINT institutional_new_stock_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.institutional_new_stock_queue ADD CONSTRAINT institutional_new_stock_queue_stock_id_key UNIQUE (stock_id);
ALTER TABLE public.publish_batch_attempts ADD CONSTRAINT publish_batch_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.system_alerts ADD CONSTRAINT system_alerts_pkey PRIMARY KEY (id);
ALTER TABLE public.tw_chip_fact ADD CONSTRAINT tw_chip_fact_pkey PRIMARY KEY (id);
ALTER TABLE public.tw_chip_fact ADD CONSTRAINT tw_chip_fact_unique_lane UNIQUE (stock_id, trade_date, broker_id, source);
ALTER TABLE public.tw_institutional_daily ADD CONSTRAINT tw_institutional_daily_pkey PRIMARY KEY (id);
ALTER TABLE public.tw_institutional_daily ADD CONSTRAINT tw_institutional_daily_stock_id_trade_date_key UNIQUE (stock_id, trade_date);

-- VIEWS
CREATE OR REPLACE VIEW public.v_active_tw_holdings AS
 SELECT DISTINCT "substring"(instrument, '^([1-9][0-9]{3})(?:\s|$)'::text) AS stock_id
   FROM trade_records tr
  WHERE market = 'TW'::text AND status::text = 'open'::text AND instrument ~ '^[1-9][0-9]{3}(?:\s|$)'::text;;

-- SUPPORT FUNCTIONS
CREATE OR REPLACE FUNCTION public.checkup_prefetch_universe()
 RETURNS TABLE(code text, supported boolean, reason text, sources text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH raw AS (
    SELECT upper(btrim((regexp_match(split_part(tr.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])) AS code,
           'trade_records'::text AS src
      FROM public.trade_records tr
     WHERE COALESCE(upper(tr.market),'TW') IN ('TW','TWSE','TPEX','')
       AND split_part(tr.instrument,' ',1) ~ '^[0-9]'
    UNION ALL
    SELECT upper(btrim((regexp_match(split_part(es.instrument,' ',1), '^([0-9A-Z]{4,6})'))[1])),
           'expert_signals'
      FROM public.expert_signals es
     WHERE es.published_at IS NOT NULL
       AND COALESCE(upper(es.market),'TW') IN ('TW','TWSE','TPEX','')
       AND split_part(es.instrument,' ',1) ~ '^[0-9]'
    UNION ALL
    SELECT upper(btrim(COALESCE(h->>'code', h->>'symbol'))), 'checkup_storage'
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(cs.data) = 'array' THEN cs.data
               WHEN jsonb_typeof(cs.data->'holdings') = 'array' THEN cs.data->'holdings'
               ELSE '[]'::jsonb
             END
           ) h
     WHERE cs.key = 'pf-holdings-v2'
    UNION ALL
    SELECT upper(btrim(t.code)), 'registry'
      FROM public.chips_prefetch_targets t
     WHERE t.active
  ),
  norm AS (
    SELECT code, src FROM raw WHERE code IS NOT NULL AND code <> ''
  ),
  agg AS (
    SELECT code, array_agg(DISTINCT src ORDER BY src) AS sources
      FROM norm GROUP BY code
  )
  SELECT a.code,
         COALESCE((public.tw_bsr_eligibility(a.code)->>'eligible')::boolean, false) AS supported,
         public.tw_bsr_eligibility(a.code)->>'ineligible_reason' AS reason,
         a.sources
    FROM agg a;
$function$
;

-- Data API grants mirroring production (pre-cutover shape)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backfill_job_queue TO authenticated;
GRANT ALL ON public.backfill_job_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkup_storage TO authenticated;
GRANT ALL ON public.checkup_storage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.function_run_logs TO authenticated;
GRANT ALL ON public.function_run_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institutional_new_stock_queue TO authenticated;
GRANT ALL ON public.institutional_new_stock_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_batch_attempts TO authenticated;
GRANT ALL ON public.publish_batch_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tw_chip_fact TO authenticated;
GRANT ALL ON public.tw_chip_fact TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tw_institutional_daily TO authenticated;
GRANT ALL ON public.tw_institutional_daily TO service_role;
