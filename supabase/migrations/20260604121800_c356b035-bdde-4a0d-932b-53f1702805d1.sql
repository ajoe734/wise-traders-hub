-- ============================================================
-- 1. Trigger functions: revoke from public/anon/authenticated entirely.
--    Triggers don't require EXECUTE on the function; revoking is safe.
-- ============================================================
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.handle_new_user()',
    'public.handle_signal_takedown()',
    'public.handle_signal_trade()',
    'public.enforce_plan_review_workflow()',
    'public.enforce_signal_capital_limit()',
    'public.enforce_signal_recall_same_day()',
    'public.enforce_user_performance_price()',
    'public.protect_backtest_fields()',
    'public.protect_profile_fields()',
    'public.protect_subscription_fields()',
    'public.notify_subscribers_on_announcement()',
    'public.recalc_user_summary_on_perf_delete()',
    'public.set_plan_initial_review_status()',
    'public.snapshot_meta_override()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- ============================================================
-- 2. Cron / maintenance functions: service_role only.
-- ============================================================
REVOKE ALL ON FUNCTION public.cleanup_old_announcements()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_perf_metrics()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_traffic()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_expired_binding_codes()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_old_prices()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_and_promote_knowledge(uuid, jsonb, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_expert_performance(uuid)  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. Quota consumption: service_role only (edge functions call it).
-- ============================================================
REVOKE ALL ON FUNCTION public.consume_checkup_quota(uuid, text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. Admin-only RPC: revoke anon (authenticated keeps; internal has_role gate).
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.admin_checkup_usage_overview()                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_perf_metrics_summary(integer)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_journey(text, timestamptz, timestamptz)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_event_heatmap(timestamptz, timestamptz)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_page_analytics(timestamptz, timestamptz, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_product_breakdown(timestamptz, timestamptz)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_top_instruments(timestamptz, timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_traffic_overview(timestamptz, timestamptz)    FROM anon;

-- ============================================================
-- 5. Admin-only RPC: get_expert_capital_status is only called from admin pages.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_expert_capital_status(uuid) FROM anon;

-- ============================================================
-- 6. Weekly leaderboard: hook is unused at the moment; tighten to authenticated.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_weekly_limit_up_leaderboard(date, date) FROM anon;

-- ============================================================
-- KEPT (intentional, not touched):
--   - has_role / has_active_subscription / has_active_subscription_after
--     / is_subscribed_to_plan / is_tester  -> needed by RLS policies, both roles
--   - get_pricing_bundle / get_public_experts_list / get_expert_detail_bundle
--     -> public marketing pages, anon required
--   - check_knowledge_title_similarity  -> already authenticated-only
--   - check_checkup_quota / get_funnel_overview / get_page_analytics ... (auth)
--     -> already converged in previous round / above
-- ============================================================