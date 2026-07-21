
-- ============================================================
-- trade_dedupe_sweep: 自動去重與告警排程
-- ============================================================

CREATE OR REPLACE FUNCTION public.trade_dedupe_sweep(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id text := gen_random_uuid()::text;
  v_scanned int := 0;
  v_auto_fixed int := 0;
  v_needs_review int := 0;
  v_removed_total int := 0;
  v_manual_list jsonb := '[]'::jsonb;
  v_alert_id uuid;
  r record;
  v_keep uuid;
  v_remove uuid[];
BEGIN
  INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, payload)
  VALUES ('trade_dedupe_sweep', v_run_id, 'info', 'start',
          format('dry_run=%s', p_dry_run),
          jsonb_build_object('dry_run', p_dry_run));

  FOR r IN
    WITH grp AS (
      SELECT
        t.signal_id,
        COUNT(*)::int AS c,
        COUNT(*) FILTER (WHERE t.exit_date IS NULL)::int AS oc,
        array_agg(t.id ORDER BY t.created_at ASC, t.id ASC) AS ids,
        (
          BOOL_OR(t.exit_date IS NOT NULL)
          OR COUNT(DISTINCT t.entry_price) > 1
          OR COUNT(DISTINCT t.quantity) > 1
          OR COUNT(DISTINCT t.quantity_unit) > 1
          OR COUNT(DISTINCT t.entry_date) > 1
        ) AS manual
      FROM public.trade_records t
      WHERE t.signal_id IS NOT NULL
      GROUP BY t.signal_id
      HAVING COUNT(*) > 1
    )
    SELECT g.signal_id, g.c AS dup_count, g.oc AS open_count, g.ids, g.manual,
           s.expert_id, s.instrument
    FROM grp g
    LEFT JOIN public.expert_signals s ON s.id = g.signal_id
  LOOP
    v_scanned := v_scanned + 1;

    IF r.manual THEN
      v_needs_review := v_needs_review + 1;
      v_manual_list := v_manual_list || jsonb_build_object(
        'signal_id', r.signal_id,
        'expert_id', r.expert_id,
        'instrument', r.instrument,
        'dup_count', r.dup_count,
        'open_count', r.open_count,
        'trade_ids', to_jsonb(r.ids)
      );

      INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
      VALUES ('trade_dedupe_sweep', v_run_id, 'warning', 'skipped',
              'manual edit detected — human review required',
              r.signal_id, r.expert_id,
              jsonb_build_object('dup_count', r.dup_count, 'open_count', r.open_count,
                                 'trade_ids', to_jsonb(r.ids), 'instrument', r.instrument));
      CONTINUE;
    END IF;

    -- 乾淨個案：保留 ids[1]（最舊），刪除其餘
    v_keep := r.ids[1];
    v_remove := r.ids[2:array_length(r.ids, 1)];

    IF p_dry_run THEN
      INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
      VALUES ('trade_dedupe_sweep', v_run_id, 'info', 'fixed',
              format('DRY RUN would remove %s rows', array_length(v_remove, 1)),
              r.signal_id, r.expert_id,
              jsonb_build_object('kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
                                 'instrument', r.instrument, 'dry_run', true));
    ELSE
      DELETE FROM public.trade_records WHERE id = ANY(v_remove);

      INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
      VALUES (
        NULL, 'signal_dupe_trade_auto_fix', 'signal', r.signal_id,
        jsonb_build_object(
          'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
          'removed_count', array_length(v_remove, 1),
          'expert_id', r.expert_id, 'instrument', r.instrument,
          'run_id', v_run_id, 'source', 'trade_dedupe_sweep'
        )
      );

      INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
      VALUES ('trade_dedupe_sweep', v_run_id, 'info', 'fixed',
              format('removed %s rows', array_length(v_remove, 1)),
              r.signal_id, r.expert_id,
              jsonb_build_object('kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
                                 'instrument', r.instrument));

      v_removed_total := v_removed_total + COALESCE(array_length(v_remove, 1), 0);
    END IF;

    v_auto_fixed := v_auto_fixed + 1;
  END LOOP;

  -- 手動編輯告警：有就開，沒就自動收單
  IF v_needs_review > 0 THEN
    INSERT INTO public.system_alerts (kind, level, title, message, metric_value, detail)
    VALUES (
      'trade_dedupe_manual_review_required', 'warning',
      format('有 %s 筆重複 trade_records 需要人工審核', v_needs_review),
      '請至 /company/signal-dupe-audit 審核有手動編輯痕跡的重複個案',
      v_needs_review,
      jsonb_build_object('run_id', v_run_id, 'items', v_manual_list)
    )
    RETURNING id INTO v_alert_id;
  ELSE
    UPDATE public.system_alerts
       SET resolved_at = now()
     WHERE kind = 'trade_dedupe_manual_review_required'
       AND resolved_at IS NULL;
  END IF;

  -- 自動修復量爆增：暗示 trigger 或應用層破功
  IF v_auto_fixed > 20 AND NOT p_dry_run THEN
    INSERT INTO public.system_alerts (kind, level, title, message, metric_value, threshold, detail)
    VALUES (
      'trade_dedupe_surge', 'critical',
      format('單輪自動修復 %s 筆，疑似 trigger/併發保護失效', v_auto_fixed),
      '請立即檢查 handle_signal_trade trigger 與訊號送出路徑',
      v_auto_fixed, 20,
      jsonb_build_object('run_id', v_run_id, 'removed_total', v_removed_total)
    );
  END IF;

  INSERT INTO public.function_run_logs (fn, run_id, level, stage, msg, payload)
  VALUES ('trade_dedupe_sweep', v_run_id,
          CASE WHEN v_needs_review > 0 THEN 'warning' ELSE 'info' END,
          'done',
          format('scanned=%s auto_fixed=%s needs_review=%s removed=%s',
                 v_scanned, v_auto_fixed, v_needs_review, v_removed_total),
          jsonb_build_object(
            'scanned', v_scanned,
            'auto_fixed', v_auto_fixed,
            'needs_review', v_needs_review,
            'removed_total', v_removed_total,
            'dry_run', p_dry_run,
            'alert_id', v_alert_id
          ));

  RETURN jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'scanned', v_scanned,
    'auto_fixed', v_auto_fixed,
    'needs_review', v_needs_review,
    'removed_total', v_removed_total,
    'alert_id', v_alert_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.trade_dedupe_sweep(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trade_dedupe_sweep(boolean) TO service_role;

-- Company admin 可從前端手動觸發
CREATE OR REPLACE FUNCTION public.admin_trade_dedupe_sweep(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.trade_dedupe_sweep(p_dry_run);
END
$$;

REVOKE ALL ON FUNCTION public.admin_trade_dedupe_sweep(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_trade_dedupe_sweep(boolean) TO authenticated;

-- ============================================================
-- 排程：每 15 分鐘一次
-- ============================================================
DO $cron$
BEGIN
  PERFORM cron.unschedule('trade-dedupe-sweep-15min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trade-dedupe-sweep-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;

SELECT cron.schedule(
  'trade-dedupe-sweep-15min',
  '*/15 * * * *',
  $sql$ SELECT public.trade_dedupe_sweep(false); $sql$
);
