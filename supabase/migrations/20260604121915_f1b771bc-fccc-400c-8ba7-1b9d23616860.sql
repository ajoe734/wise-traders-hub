-- PUBLIC implicit grant must be revoked explicitly; FROM anon alone is insufficient.

-- Admin / company traffic RPCs: keep authenticated only (has_role gate inside).
REVOKE EXECUTE ON FUNCTION public.admin_checkup_usage_overview()                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_perf_metrics_summary(integer)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_journey(text, timestamptz, timestamptz)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_event_heatmap(timestamptz, timestamptz)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_page_analytics(timestamptz, timestamptz, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_breakdown(timestamptz, timestamptz)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_top_instruments(timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_traffic_overview(timestamptz, timestamptz)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_expert_capital_status(uuid)                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_weekly_limit_up_leaderboard(date, date)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_checkup_quota(uuid)                          FROM PUBLIC;

-- Re-ensure authenticated retains the privilege (admin pages need it).
GRANT EXECUTE ON FUNCTION public.admin_checkup_usage_overview()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_perf_metrics_summary(integer)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_journey(text, timestamptz, timestamptz)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_heatmap(timestamptz, timestamptz)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_analytics(timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_breakdown(timestamptz, timestamptz)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_instruments(timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_traffic_overview(timestamptz, timestamptz)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expert_capital_status(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_limit_up_leaderboard(date, date)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_checkup_quota(uuid)                          TO authenticated;

-- Trigger / cron functions: completely revoke PUBLIC too.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_signal_takedown()                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_signal_trade()                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_plan_review_workflow()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_signal_capital_limit()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_signal_recall_same_day()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_user_performance_price()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_backtest_fields()                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_profile_fields()                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_subscription_fields()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_subscribers_on_announcement()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalc_user_summary_on_perf_delete()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_plan_initial_review_status()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snapshot_meta_override()                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_announcements()                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_perf_metrics()                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_traffic()                              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_expired_binding_codes()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_old_prices()                                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_and_promote_knowledge(uuid, jsonb, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_expert_performance(uuid)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_checkup_quota(uuid, text)                  FROM PUBLIC;