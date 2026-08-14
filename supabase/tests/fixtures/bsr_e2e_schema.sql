-- ephemeral-only auth stub：user_roles / experts 具 auth.users FK，載入前必須先存在。
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TYPE public.app_role AS ENUM ('company_admin', 'analyst');
CREATE TYPE public.expert_role AS ENUM ('advisor', 'mentor');
--
-- PostgreSQL database dump
--

\restrict Xhxp6Rcc5Uont7dGBikGaLduMxE1vZ6QCUnsuVczZjz5IxLlWANnR3eb6iov3Fc

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9



--
-- Name: bsr_coverage_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bsr_coverage_daily (
    stock_id text NOT NULL,
    trade_date date NOT NULL,
    broker_count integer DEFAULT 0 NOT NULL,
    broker_sum_shares bigint DEFAULT 0 NOT NULL,
    snapshot_volume_shares bigint,
    coverage_pct numeric(8,2),
    coverage_class text DEFAULT 'unknown'::text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tw_bsr_daily_snapshot_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tw_bsr_daily_snapshot_status (
    trade_date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    source text,
    fetched_at timestamp with time zone,
    coverage_stocks integer DEFAULT 0 NOT NULL,
    coverage_rows integer DEFAULT 0 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    correlation_id uuid,
    lock_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sealed_at timestamp with time zone,
    sealed_by_lane text,
    coverage_brokers integer DEFAULT 0 NOT NULL,
    lane_a_status text DEFAULT 'pending'::text NOT NULL,
    lane_b_status text DEFAULT 'pending'::text NOT NULL,
    lane_c_status text DEFAULT 'pending'::text NOT NULL,
    partial_lanes text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT tw_bsr_daily_snapshot_status_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['finmind_market_batch'::text, 'finmind_per_stock'::text, 'twse_official'::text, 'tpex_official'::text, 'broker_scrape'::text, 'reconciled'::text, 'manual'::text])))),
    CONSTRAINT tw_bsr_daily_snapshot_status_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'fetching'::text, 'ready'::text, 'partial'::text, 'exhausted'::text, 'failed'::text])))
);


--
-- Name: finmind_quota_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finmind_quota_ledger (
    id bigint NOT NULL,
    pool_name text NOT NULL,
    request_kind text NOT NULL,
    stock_id text,
    granted boolean NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    borrowed_from text,
    root_cause_hint text
);


--
-- Name: daily_price_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_price_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    symbol text NOT NULL,
    trade_date date NOT NULL,
    close_price numeric,
    yesterday_close numeric,
    change_percent numeric,
    is_limit_up boolean DEFAULT false NOT NULL,
    limit_up_price numeric,
    volume bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    open_price numeric,
    high_price numeric,
    low_price numeric,
    volume_ma5 numeric,
    market text DEFAULT 'TW'::text NOT NULL,
    volume_unit text,
    volume_shares bigint
);


--
-- Name: experts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    role public.expert_role NOT NULL,
    bio text,
    description text,
    style_tags text[],
    markets text[],
    avatar_url text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    strategy_summary text,
    backtest_1y_return numeric,
    backtest_max_drawdown numeric,
    backtest_annual_return numeric,
    starting_capital integer,
    risk_preference text,
    operation_cycle text,
    strategy_name text,
    currency text DEFAULT 'TWD'::text NOT NULL,
    asset_class text DEFAULT 'tw_stock'::text NOT NULL,
    CONSTRAINT experts_asset_class_check CHECK ((asset_class = ANY (ARRAY['tw_stock'::text, 'us_stock'::text, 'crypto'::text, 'us_option'::text, 'us_future'::text]))),
    CONSTRAINT experts_currency_check CHECK ((currency = ANY (ARRAY['TWD'::text, 'USD'::text])))
);


--
-- Name: finmind_inflight_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finmind_inflight_requests (
    key text NOT NULL,
    stock_id text,
    kind text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:00:30'::interval) NOT NULL
);


--
-- Name: finmind_quota_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finmind_quota_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finmind_quota_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finmind_quota_ledger_id_seq OWNED BY public.finmind_quota_ledger.id;


--
-- Name: finmind_upstream_quota; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finmind_upstream_quota (
    source text NOT NULL,
    remaining integer,
    quota_limit integer,
    reset_at timestamp with time zone,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    raw jsonb
);


--
-- Name: price_quota_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_quota_ledger (
    id bigint NOT NULL,
    market text NOT NULL,
    requested integer NOT NULL,
    admitted integer NOT NULL,
    tokens_after double precision NOT NULL,
    writer text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_quota_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_quota_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: price_quota_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_quota_ledger_id_seq OWNED BY public.price_quota_ledger.id;


--
-- Name: price_quota_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_quota_pools (
    market text NOT NULL,
    api_name text NOT NULL,
    per_min_cap integer NOT NULL,
    per_day_cap integer,
    tokens double precision DEFAULT 0 NOT NULL,
    last_refill timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tw_bsr_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tw_bsr_daily (
    id bigint NOT NULL,
    stock_id text NOT NULL,
    trade_date date NOT NULL,
    broker_id text NOT NULL,
    broker_name text NOT NULL,
    buy_shares bigint DEFAULT 0 NOT NULL,
    sell_shares bigint DEFAULT 0 NOT NULL,
    net_shares bigint DEFAULT 0 NOT NULL,
    avg_buy_price numeric(12,4),
    avg_sell_price numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tw_bsr_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tw_bsr_daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tw_bsr_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tw_bsr_daily_id_seq OWNED BY public.tw_bsr_daily.id;


--
-- Name: tw_bsr_fetch_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tw_bsr_fetch_failures (
    id bigint NOT NULL,
    stock_id text NOT NULL,
    trade_date date NOT NULL,
    reason text NOT NULL,
    attempts smallint DEFAULT 1 NOT NULL,
    last_error text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    next_retry_at timestamp with time zone,
    backoff_seconds integer DEFAULT 60 NOT NULL,
    consecutive_failures integer DEFAULT 1 NOT NULL,
    error_class text,
    correlation_id uuid
);


--
-- Name: tw_bsr_fetch_failures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tw_bsr_fetch_failures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tw_bsr_fetch_failures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tw_bsr_fetch_failures_id_seq OWNED BY public.tw_bsr_fetch_failures.id;


--
-- Name: tw_bsr_upstream_probe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tw_bsr_upstream_probe (
    stock_id text NOT NULL,
    earliest_data date,
    probed_back_to date,
    empty_streak integer DEFAULT 0 NOT NULL,
    exhausted boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tw_chips_rollup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tw_chips_rollup (
    id bigint NOT NULL,
    stock_id text NOT NULL,
    as_of_date date NOT NULL,
    window_days smallint NOT NULL,
    foreign_net bigint DEFAULT 0 NOT NULL,
    trust_net bigint DEFAULT 0 NOT NULL,
    dealer_net bigint DEFAULT 0 NOT NULL,
    top_buy_brokers jsonb DEFAULT '[]'::jsonb NOT NULL,
    top_sell_brokers jsonb DEFAULT '[]'::jsonb NOT NULL,
    concentration_ratio numeric(5,2),
    bsr_available boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    broker_count integer,
    low_quality boolean,
    source_date date DEFAULT CURRENT_DATE NOT NULL,
    fallback_used boolean DEFAULT false NOT NULL,
    CONSTRAINT tw_chips_rollup_window_days_check CHECK ((window_days = ANY (ARRAY[1, 5, 10, 20, 60])))
);


--
-- Name: tw_chips_rollup_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tw_chips_rollup_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tw_chips_rollup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tw_chips_rollup_id_seq OWNED BY public.tw_chips_rollup.id;


--
-- Name: tw_institutional_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tw_institutional_daily (
    id bigint NOT NULL,
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


--
-- Name: tw_institutional_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tw_institutional_daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tw_institutional_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tw_institutional_daily_id_seq OWNED BY public.tw_institutional_daily.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL
);


--
-- Name: finmind_quota_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finmind_quota_ledger ALTER COLUMN id SET DEFAULT nextval('public.finmind_quota_ledger_id_seq'::regclass);


--
-- Name: price_quota_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_quota_ledger ALTER COLUMN id SET DEFAULT nextval('public.price_quota_ledger_id_seq'::regclass);


--
-- Name: tw_bsr_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_daily ALTER COLUMN id SET DEFAULT nextval('public.tw_bsr_daily_id_seq'::regclass);


--
-- Name: tw_bsr_fetch_failures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_fetch_failures ALTER COLUMN id SET DEFAULT nextval('public.tw_bsr_fetch_failures_id_seq'::regclass);


--
-- Name: tw_chips_rollup id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_chips_rollup ALTER COLUMN id SET DEFAULT nextval('public.tw_chips_rollup_id_seq'::regclass);


--
-- Name: tw_institutional_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_institutional_daily ALTER COLUMN id SET DEFAULT nextval('public.tw_institutional_daily_id_seq'::regclass);


--
-- Name: bsr_coverage_daily bsr_coverage_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bsr_coverage_daily
    ADD CONSTRAINT bsr_coverage_daily_pkey PRIMARY KEY (stock_id, trade_date);


--
-- Name: daily_price_snapshots daily_price_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_price_snapshots
    ADD CONSTRAINT daily_price_snapshots_pkey PRIMARY KEY (id);


--
-- Name: daily_price_snapshots daily_price_snapshots_symbol_trade_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_price_snapshots
    ADD CONSTRAINT daily_price_snapshots_symbol_trade_date_key UNIQUE (symbol, trade_date);


--
-- Name: experts experts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experts
    ADD CONSTRAINT experts_pkey PRIMARY KEY (id);


--
-- Name: experts experts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experts
    ADD CONSTRAINT experts_slug_key UNIQUE (slug);


--
-- Name: finmind_inflight_requests finmind_inflight_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finmind_inflight_requests
    ADD CONSTRAINT finmind_inflight_requests_pkey PRIMARY KEY (key);


--
-- Name: finmind_quota_ledger finmind_quota_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finmind_quota_ledger
    ADD CONSTRAINT finmind_quota_ledger_pkey PRIMARY KEY (id);


--
-- Name: finmind_upstream_quota finmind_upstream_quota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finmind_upstream_quota
    ADD CONSTRAINT finmind_upstream_quota_pkey PRIMARY KEY (source);


--
-- Name: price_quota_ledger price_quota_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_quota_ledger
    ADD CONSTRAINT price_quota_ledger_pkey PRIMARY KEY (id);


--
-- Name: price_quota_pools price_quota_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_quota_pools
    ADD CONSTRAINT price_quota_pools_pkey PRIMARY KEY (market);


--
-- Name: tw_bsr_daily tw_bsr_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_daily
    ADD CONSTRAINT tw_bsr_daily_pkey PRIMARY KEY (id);


--
-- Name: tw_bsr_daily_snapshot_status tw_bsr_daily_snapshot_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_daily_snapshot_status
    ADD CONSTRAINT tw_bsr_daily_snapshot_status_pkey PRIMARY KEY (trade_date);


--
-- Name: tw_bsr_daily tw_bsr_daily_stock_id_trade_date_broker_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_daily
    ADD CONSTRAINT tw_bsr_daily_stock_id_trade_date_broker_id_key UNIQUE (stock_id, trade_date, broker_id);


--
-- Name: tw_bsr_fetch_failures tw_bsr_fetch_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_fetch_failures
    ADD CONSTRAINT tw_bsr_fetch_failures_pkey PRIMARY KEY (id);


--
-- Name: tw_bsr_fetch_failures tw_bsr_fetch_failures_stock_id_trade_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_fetch_failures
    ADD CONSTRAINT tw_bsr_fetch_failures_stock_id_trade_date_key UNIQUE (stock_id, trade_date);


--
-- Name: tw_bsr_upstream_probe tw_bsr_upstream_probe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_bsr_upstream_probe
    ADD CONSTRAINT tw_bsr_upstream_probe_pkey PRIMARY KEY (stock_id);


--
-- Name: tw_chips_rollup tw_chips_rollup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_chips_rollup
    ADD CONSTRAINT tw_chips_rollup_pkey PRIMARY KEY (id);


--
-- Name: tw_chips_rollup tw_chips_rollup_stock_id_as_of_date_window_days_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_chips_rollup
    ADD CONSTRAINT tw_chips_rollup_stock_id_as_of_date_window_days_key UNIQUE (stock_id, as_of_date, window_days);


--
-- Name: tw_institutional_daily tw_institutional_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_institutional_daily
    ADD CONSTRAINT tw_institutional_daily_pkey PRIMARY KEY (id);


--
-- Name: tw_institutional_daily tw_institutional_daily_stock_id_trade_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tw_institutional_daily
    ADD CONSTRAINT tw_institutional_daily_stock_id_trade_date_key UNIQUE (stock_id, trade_date);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: idx_bsr_coverage_daily_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsr_coverage_daily_class ON public.bsr_coverage_daily USING btree (coverage_class, trade_date DESC);


--
-- Name: idx_bsr_coverage_daily_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsr_coverage_daily_date ON public.bsr_coverage_daily USING btree (trade_date DESC);


--
-- Name: idx_bsr_snapshot_status_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsr_snapshot_status_status ON public.tw_bsr_daily_snapshot_status USING btree (status, trade_date DESC);


--
-- Name: idx_daily_price_snapshots_missing_volume_shares; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_price_snapshots_missing_volume_shares ON public.daily_price_snapshots USING btree (market, trade_date) WHERE (volume_shares IS NULL);


--
-- Name: idx_experts_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experts_status_created ON public.experts USING btree (status, created_at);


--
-- Name: idx_finmind_quota_ledger_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finmind_quota_ledger_created ON public.finmind_quota_ledger USING btree (created_at DESC);


--
-- Name: idx_finmind_quota_ledger_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finmind_quota_ledger_pool ON public.finmind_quota_ledger USING btree (pool_name, created_at DESC);


--
-- Name: idx_finmind_quota_ledger_pool_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finmind_quota_ledger_pool_time ON public.finmind_quota_ledger USING btree (pool_name, created_at DESC);


--
-- Name: idx_price_quota_ledger_market_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_quota_ledger_market_time ON public.price_quota_ledger USING btree (market, created_at DESC);


--
-- Name: idx_snapshot_status_sealed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshot_status_sealed ON public.tw_bsr_daily_snapshot_status USING btree (sealed_at DESC NULLS LAST);


--
-- Name: idx_snapshots_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_date ON public.daily_price_snapshots USING btree (trade_date);


--
-- Name: idx_snapshots_limit_up; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_limit_up ON public.daily_price_snapshots USING btree (is_limit_up, trade_date) WHERE (is_limit_up = true);


--
-- Name: idx_snapshots_symbol_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_symbol_date ON public.daily_price_snapshots USING btree (symbol, trade_date);


--
-- Name: idx_tw_bsr_fail_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_bsr_fail_unresolved ON public.tw_bsr_fetch_failures USING btree (trade_date DESC) WHERE (resolved_at IS NULL);


--
-- Name: idx_tw_bsr_fetch_failures_error_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_bsr_fetch_failures_error_class ON public.tw_bsr_fetch_failures USING btree (error_class);


--
-- Name: idx_tw_bsr_stock_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_bsr_stock_date ON public.tw_bsr_daily USING btree (stock_id, trade_date DESC);


--
-- Name: idx_tw_bsr_stock_date_net; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_bsr_stock_date_net ON public.tw_bsr_daily USING btree (stock_id, trade_date DESC, net_shares);


--
-- Name: idx_tw_chips_rollup_fallback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_chips_rollup_fallback ON public.tw_chips_rollup USING btree (as_of_date, fallback_used);


--
-- Name: idx_tw_inst_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_inst_date ON public.tw_institutional_daily USING btree (trade_date DESC);


--
-- Name: idx_tw_inst_stock_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_inst_stock_date ON public.tw_institutional_daily USING btree (stock_id, trade_date DESC);


--
-- Name: idx_tw_institutional_daily_date_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_institutional_daily_date_source ON public.tw_institutional_daily USING btree (trade_date, source);


--
-- Name: idx_tw_rollup_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tw_rollup_lookup ON public.tw_chips_rollup USING btree (stock_id, as_of_date DESC, window_days);


--
-- Name: tw_bsr_fetch_failures_cid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tw_bsr_fetch_failures_cid_idx ON public.tw_bsr_fetch_failures USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: tw_bsr_fetch_failures_next_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tw_bsr_fetch_failures_next_retry_idx ON public.tw_bsr_fetch_failures USING btree (next_retry_at) WHERE (resolved_at IS NULL);


--
-- Name: daily_price_snapshots daily_snapshot_normalize_volume; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_bsr_daily enforce_snapshot_immutability; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: experts protect_experts_backtest_fields; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: experts trg_enforce_expert_asset_class_lock; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: experts trg_enforce_expert_currency_lock; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: experts trg_sync_expert_currency; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: experts trg_sync_expert_slug_to_profile; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_bsr_daily trg_tw_bsr_daily_immutable; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_bsr_fetch_failures trg_tw_bsr_fail_updated; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_institutional_daily trg_tw_inst_daily_immutable; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_institutional_daily trg_tw_inst_updated; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_chips_rollup trg_tw_rollup_updated; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_bsr_daily_snapshot_status tw_bsr_snapshot_status_touch; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: tw_chips_rollup tw_chips_rollup_default_source_date_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: experts Analysts can update own expert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: experts Analysts can view own expert; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: experts Anyone can view active experts; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: daily_price_snapshots Anyone can view snapshots; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: user_roles Company admins can manage roles; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: user_roles Company admins can view all roles; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: experts Company admins full access experts; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: experts Subscribers can view subscribed experts; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: user_roles Users can view own roles; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: finmind_quota_ledger admin read finmind quota ledger; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: finmind_upstream_quota admin read finmind upstream quota; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: finmind_inflight_requests admin read inflight; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: tw_bsr_daily_snapshot_status admin read snapshot status; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: tw_bsr_upstream_probe authenticated read probe; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: bsr_coverage_daily; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: bsr_coverage_daily bsr_coverage_daily_admin_read; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: daily_price_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: experts; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: finmind_inflight_requests; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: finmind_quota_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: finmind_upstream_quota; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: price_quota_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: price_quota_pools; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: price_quota_ledger quota ledger admin read; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: price_quota_pools quota pools admin read; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: finmind_quota_ledger service write finmind quota ledger; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: finmind_upstream_quota service write finmind upstream quota; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: finmind_inflight_requests service write inflight; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: tw_bsr_daily tw_bsr_authenticated_read; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: tw_bsr_daily; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: tw_bsr_daily_snapshot_status; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: tw_bsr_fetch_failures; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: tw_bsr_upstream_probe; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: tw_chips_rollup; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: tw_institutional_daily tw_inst_authenticated_read; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: tw_institutional_daily; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- Name: tw_chips_rollup tw_rollup_authenticated_read; Type: POLICY; Schema: public; Owner: -
--



--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--


--
-- PostgreSQL database dump complete
--

\unrestrict Xhxp6Rcc5Uont7dGBikGaLduMxE1vZ6QCUnsuVczZjz5IxLlWANnR3eb6iov3Fc

