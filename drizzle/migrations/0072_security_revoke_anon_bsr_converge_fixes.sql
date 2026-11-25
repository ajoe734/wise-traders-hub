CREATE OR REPLACE FUNCTION public.converge_bsr_windows(p_max_stocks integer DEFAULT 500, p_chunk_dates integer DEFAULT 15, p_horizon_days integer DEFAULT 110)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_expected date := public.expected_latest_bsr_date();
  v_stock text; v_readiness jsonb; v_latest date;
  v_stocks_scanned int := 0; v_stocks_converged int := 0;
  v_stocks_exhausted int := 0; v_stocks_ready int := 0;
  v_stocks_total int := 0; v_jobs_created int := 0; v_stocks_stale int := 0;
  v_d date; v_added int; v_valid_dates date[]; v_valid_days int;
BEGIN
  CREATE TEMP TABLE _conv_cand ON COMMIT DROP AS
  WITH t AS (
    SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
      FROM public.trade_records
     WHERE UPPER(COALESCE(market,'TW')) IN ('TW','TWSE','TPEX','') AND instrument ~ '^[1-9][0-9]{3}'
  ), c AS (
    SELECT DISTINCT h->>'symbol' AS sid
      FROM public.checkup_storage cs,
           LATERAL jsonb_array_elements(COALESCE(cs.data->'holdings','[]'::jsonb)) h
     WHERE cs.key IN ('portfolio','holdings','state')
  ), e AS (
    SELECT DISTINCT (regexp_match(instrument, '^([1-9][0-9]{3})(?:[[:space:]]|$)'))[1] AS sid
      FROM public.expert_signals
     WHERE status = 'published' AND UPPER(COALESCE(market,'TW')) IN ('TW','TWSE','TPEX','')
       AND created_at >= now() - INTERVAL '180 days' AND instrument ~ '^[1-9][0-9]{3}'
  ), all_stocks AS (
    SELECT sid FROM t WHERE sid ~ '^[1-9][0-9]{3}$'
    UNION SELECT sid FROM c WHERE sid ~ '^[1-9][0-9]{3}$'
    UNION SELECT sid FROM e WHERE sid ~ '^[1-9][0-9]{3}$'
  )
  -- Per-candidate index lookups instead of grouping all of tw_bsr_daily (statement timeouts, 2026-11).
  SELECT s.sid,
         COALESCE((SELECT COUNT(DISTINCT d.trade_date)::int FROM public.tw_bsr_daily d
                    WHERE d.stock_id = s.sid AND d.trade_date >= v_today - 90), 0) AS valid_days,
         (SELECT MAX(d.trade_date) FROM public.tw_bsr_daily d WHERE d.stock_id = s.sid) AS last_valid
    FROM all_stocks s;

  FOR v_stock, v_valid_days IN
    SELECT sid, valid_days FROM _conv_cand
     ORDER BY valid_days ASC, last_valid ASC NULLS FIRST, sid
     LIMIT p_max_stocks
  LOOP
    v_stocks_total := v_stocks_total + 1;
    IF NOT COALESCE((public.tw_bsr_eligibility(v_stock)->>'eligible')::boolean,false) THEN CONTINUE; END IF;
    v_stocks_scanned := v_stocks_scanned + 1;
    v_readiness := public.compute_bsr_series_readiness(v_stock);
    v_latest := NULLIF(v_readiness->>'latest_available','')::date;

    IF COALESCE((v_readiness->>'ready60')::boolean,false)
       AND v_latest IS NOT NULL AND v_latest >= v_expected THEN
      v_stocks_ready := v_stocks_ready + 1; CONTINUE;
    END IF;
    IF v_latest IS NOT NULL AND v_latest < v_expected THEN v_stocks_stale := v_stocks_stale + 1; END IF;
    IF COALESCE((v_readiness->>'exhausted')::boolean,false)
       AND COALESCE((v_readiness->>'ready60')::boolean,false)
       AND v_latest IS NOT NULL AND v_latest >= v_expected THEN
      v_stocks_exhausted := v_stocks_exhausted + 1; CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(trade_date), ARRAY[]::date[]) INTO v_valid_dates
      FROM (SELECT trade_date FROM public.tw_bsr_daily WHERE stock_id=v_stock
             AND trade_date >= v_today - p_horizon_days
            GROUP BY trade_date HAVING COUNT(DISTINCT broker_id) >= 1) x;

    v_d := v_expected; v_added := 0;
    WHILE v_added < p_chunk_dates AND v_d > v_today - p_horizon_days LOOP
      IF EXTRACT(ISODOW FROM v_d) < 6
         AND NOT EXISTS (SELECT 1 FROM public.tw_market_holidays h WHERE h.trade_date = v_d)
         AND NOT (v_d = ANY(v_valid_dates)) THEN
        BEGIN
          INSERT INTO public.tw_bsr_sync_queue (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
          VALUES (v_stock, v_d, CASE WHEN v_d >= v_expected THEN 1 ELSE 2 END, 'pending', now(), 'converge_bsr_windows', gen_random_uuid(), false)
          ON CONFLICT DO NOTHING;
          IF FOUND THEN v_jobs_created := v_jobs_created+1; v_added := v_added+1; END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
      v_d := v_d - 1;
    END LOOP;
    IF v_added > 0 THEN v_stocks_converged := v_stocks_converged + 1; END IF;
  END LOOP;

  DROP TABLE IF EXISTS _conv_cand;

  RETURN jsonb_build_object(
    'stocks_total', v_stocks_total, 'stocks_scanned', v_stocks_scanned,
    'stocks_ready', v_stocks_ready, 'stocks_stale', v_stocks_stale,
    'stocks_exhausted', v_stocks_exhausted, 'stocks_converged', v_stocks_converged,
    'jobs_created', v_jobs_created, 'expected_latest', v_expected, 'deterministic_order', true,
    'params', jsonb_build_object('max_stocks', p_max_stocks, 'chunk_dates', p_chunk_dates, 'horizon_days', p_horizon_days, 'threshold', 1)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_publish_batch_runs(_limit integer DEFAULT 20)
 RETURNS TABLE(run_id text, started_at timestamp with time zone, ended_at timestamp with time zone, market text, pending_found integer, published integer, failed integer, pushed integer, push_fail integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT l.run_id AS rid, l.created_at AS ts, l.stage AS st, l.msg AS m
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.created_at >= now() - interval '14 days'
  ),
  runs AS (
    SELECT rid,
           min(ts) AS r_started,
           max(ts) AS r_ended,
           max(CASE WHEN st='filter_by_market' THEN split_part(m,' ',3) END) AS market_raw,
           max(CASE WHEN st='fetch_pending_signals' THEN substring(m from 'Found (\d+)')::int END) AS r_pending,
           max(CASE WHEN st='mark_published' THEN substring(m from 'Published (\d+)/')::int END) AS r_published,
           max(CASE WHEN st='mark_published' THEN substring(m from 'failed=(\d+)')::int END) AS r_failed,
           max(CASE WHEN st='line_push' THEN substring(m from 'pushed=(\d+)')::int END) AS r_pushed,
           max(CASE WHEN st='line_push' THEN substring(m from 'pushFail=(\d+)')::int END) AS r_push_fail
    FROM src
    GROUP BY rid
  )
  SELECT r.rid, r.r_started, r.r_ended,
         CASE WHEN r.market_raw ILIKE 'US%' THEN 'US'
              WHEN r.market_raw ILIKE 'TW%' THEN 'TW'
              ELSE 'ALL' END,
         COALESCE(r.r_pending,0), COALESCE(r.r_published,0), COALESCE(r.r_failed,0),
         COALESCE(r.r_pushed,0), COALESCE(r.r_push_fail,0)
  FROM runs r
  ORDER BY r.r_started DESC
  LIMIT _limit;
END $function$;

CREATE OR REPLACE FUNCTION public.get_publish_batch_status()
 RETURNS TABLE(expert_id uuid, expert_name text, expert_slug text, market text, asset_class text, pending_count integer, published_this_week integer, failed_pending_count integer, last_attempt_at timestamp with time zone, last_error_kind text, last_error_msg text, last_error_signal_id uuid, last_run_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(),'company_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH us_classes AS (
    SELECT unnest(ARRAY['us_stock','us_futures','crypto']) AS c
  ),
  base AS (
    SELECT e.id, e.name, e.slug AS b_slug, e.asset_class AS b_class,
           CASE WHEN lower(e.asset_class) IN (SELECT c FROM us_classes)
                THEN 'US' ELSE 'TW' END AS mk
    FROM public.experts e
  ),
  sig_stats AS (
    SELECT s.expert_id AS eid,
           count(*) FILTER (WHERE s.status='pending')::int AS p_cnt,
           count(*) FILTER (WHERE s.status='published' AND s.updated_at >= now() - interval '7 days')::int AS w_cnt
    FROM public.expert_signals s
    WHERE s.updated_at >= now() - interval '14 days' OR s.status='pending'
    GROUP BY s.expert_id
  ),
  err_logs AS (
    SELECT l.expert_id AS eid, l.signal_id AS sid, l.msg AS m, l.run_id AS rid, l.created_at AS ts,
           l.payload->>'kind' AS kind
    FROM public.function_run_logs l
    WHERE l.fn='publish-weekly-journals'
      AND l.stage='mark_published_iter'
      AND l.level='error'
      AND l.expert_id IS NOT NULL
      AND l.created_at >= now() - interval '14 days'
  ),
  latest_err AS (
    SELECT DISTINCT ON (el.eid) el.eid, el.ts, el.kind, el.m, el.sid, el.rid
    FROM err_logs el
    ORDER BY el.eid, el.ts DESC
  ),
  failed_pending AS (
    SELECT el.eid, count(DISTINCT el.sid)::int AS cnt
    FROM err_logs el
    JOIN public.expert_signals s ON s.id = el.sid AND s.status='pending'
    GROUP BY el.eid
  )
  SELECT b.id, b.name, b.b_slug, b.mk, b.b_class,
         COALESCE(ss.p_cnt,0), COALESCE(ss.w_cnt,0), COALESCE(fp.cnt,0),
         le.ts, le.kind, le.m, le.sid, le.rid
  FROM base b
  LEFT JOIN sig_stats ss ON ss.eid = b.id
  LEFT JOIN latest_err le ON le.eid = b.id
  LEFT JOIN failed_pending fp ON fp.eid = b.id
  WHERE COALESCE(ss.p_cnt,0) > 0 OR COALESCE(ss.w_cnt,0) > 0 OR le.ts IS NOT NULL
  ORDER BY b.mk, b.name;
END $function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
              AND p.proname = ANY(ARRAY['admin_apply_fix_proposal','admin_delete_trade_records_by_signal_ids','admin_delete_trade_records_by_symbol','admin_generate_fix_proposals','admin_holdings_consistency_audit','admin_list_cron_jobs','admin_reject_fix_proposal','admin_reset_expert_asset_class','admin_trade_dedupe_sweep','admin_update_stock_industry','append_position_event_from_signal','audit_row_change','backfill_job_set_done','backfill_job_set_failed','backfill_queue_stats','bsr_apply_degrade_transition','bsr_check_tier_admission','bsr_get_degrade_state','bsr_recent_degrade_events','bsr_snapshot_claim','bsr_snapshot_fulfill_jobs','bsr_snapshot_mark','bsr_snapshot_stats','bsr_trace_by_correlation','check_kill_switch','chip_fact_summary','claim_institutional_new_stock','cleanup_account_link_codes','cleanup_old_auth_events','cleanup_old_expert_ai_access_logs','compute_bsr_series_readiness','converge_bsr_windows','cron_edge_call','defer_bsr_job_quota','detect_fundamental_gap_jobs','enforce_expert_asset_class_lock','enforce_expert_currency_lock','enforce_snapshot_immutability','enforce_trade_record_market_currency','enforce_unit_consistency','enqueue_all_active_tw_holdings_bsr','enqueue_bsr_backfill','enqueue_bsr_first_fetch_on_trade','enqueue_institutional_new_stock','ensure_bsr_queued','ensure_bsr_window','expected_latest_bsr_date','expert_articles_guard','finmind_admit','finmind_admit_v2','finmind_inflight_acquire','finmind_inflight_release','finmind_pool_reset','finmind_pool_set_budget','get_bsr_daily_series','get_bsr_readiness_v2','get_coverage_stats','get_cron_job_runs','get_cron_jobs','get_expert_revenue_breakdown','get_fastlane_stats','get_price_parity_summary','get_publish_batch_attempts','get_publish_batch_runs','get_publish_batch_status','get_roas_ltv_by_campaign','get_user_funnel_drop','is_snapshot_sealed','is_tw_trading_day','mark_bsr_upstream_probe','match_expert_knowledge','materialize_bsr_daily_from_fact','prevent_position_event_mutation','prune_backfill_job_queue','prune_cron_dispatch_log','reap_stale_bsr_queue_jobs','reconcile_snapshot','recover_stale_backfill_jobs','refresh_bsr_coverage_daily','reserve_bsr_api_quota','reset_data_source_circuit','set_expert_signal_market','sync_expert_slug_to_profile','toggle_kill_switch','trade_dedupe_sweep','trigger_expert_ai_reindex','tw_bsr_eligibility','tw_bsr_sync_config_snapshot','tw_chips_rollup_default_source_date','tw_missing_trading_days','tw_trading_days','valuation_backfill_targets','valuation_peer_core','valuation_peer_multiples']::text[]) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace='public'::regnamespace
              AND p.proname IN ('cron_edge_call','trade_dedupe_sweep','admin_list_cron_jobs','get_cron_jobs') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

ALTER VIEW public.public_expert_state_active SET (security_invoker = off);
GRANT SELECT ON public.public_expert_state_active TO anon, authenticated, service_role;