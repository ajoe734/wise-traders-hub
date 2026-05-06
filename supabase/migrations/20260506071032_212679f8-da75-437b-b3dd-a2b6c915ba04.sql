UPDATE public.knowledge_auto_rules
SET enabled = true,
    archive_below_win_rate = 0.40,
    promote_above_win_rate = 0.70,
    auto_grid_search_below = 0.55,
    min_sample_size = 30,
    promote_min_improvement_pct = 5,
    daily_grid_search_quota = 5,
    candidate_observe_days = 14,
    rescue_max_weeks = 3,
    updated_at = now();