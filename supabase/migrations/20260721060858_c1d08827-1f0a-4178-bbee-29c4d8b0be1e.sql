
-- 掃描：每個 signal_id 對應 >1 筆 trade_records 的情況
CREATE OR REPLACE FUNCTION public.admin_signal_dupe_trades_audit()
RETURNS TABLE (
  signal_id uuid,
  expert_id uuid,
  expert_name text,
  instrument text,
  action text,
  signal_published_at timestamptz,
  dup_count integer,
  open_count integer,
  trade_ids uuid[],
  has_manual_edit boolean,
  earliest_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH grp AS (
    SELECT
      t.signal_id,
      COUNT(*)::int AS c,
      COUNT(*) FILTER (WHERE t.exit_date IS NULL)::int AS oc,
      array_agg(t.id ORDER BY t.created_at ASC, t.id ASC) AS ids,
      MIN(t.created_at) AS mn,
      -- 疑似人工編輯：任一筆已有 exit_date、或不同筆 entry_price/quantity/quantity_unit/entry_date 不一致
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
  SELECT
    g.signal_id,
    s.expert_id,
    e.name,
    COALESCE(s.instrument, ''),
    s.action::text,
    s.published_at,
    g.c,
    g.oc,
    g.ids,
    g.manual,
    g.mn
  FROM grp g
  LEFT JOIN public.expert_signals s ON s.id = g.signal_id
  LEFT JOIN public.experts e ON e.id = s.expert_id
  ORDER BY g.mn DESC NULLS LAST;
END; $$;

REVOKE ALL ON FUNCTION public.admin_signal_dupe_trades_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_signal_dupe_trades_audit() TO authenticated;

-- 修復：保留最舊，其他刪除
CREATE OR REPLACE FUNCTION public.admin_signal_dupe_trades_fix(
  p_signal_id uuid,
  p_dry_run boolean DEFAULT true,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep uuid;
  v_remove uuid[];
  v_manual boolean;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT has_role(v_actor, 'company_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_keep
  FROM public.trade_records
  WHERE signal_id = p_signal_id
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_keep IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_rows', 'kept_id', null, 'removed_ids', '[]'::jsonb, 'executed', false);
  END IF;

  SELECT array_agg(id ORDER BY created_at ASC, id ASC) INTO v_remove
  FROM public.trade_records
  WHERE signal_id = p_signal_id AND id <> v_keep;

  IF v_remove IS NULL OR array_length(v_remove, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'note', 'no_dupes', 'kept_id', v_keep, 'removed_ids', '[]'::jsonb, 'executed', false);
  END IF;

  SELECT (
    BOOL_OR(exit_date IS NOT NULL)
    OR COUNT(DISTINCT entry_price) > 1
    OR COUNT(DISTINCT quantity) > 1
    OR COUNT(DISTINCT quantity_unit) > 1
    OR COUNT(DISTINCT entry_date) > 1
  )
  INTO v_manual
  FROM public.trade_records
  WHERE signal_id = p_signal_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
      'would_remove_count', array_length(v_remove, 1),
      'has_manual_edit', v_manual, 'executed', false
    );
  END IF;

  IF v_manual AND NOT p_force THEN
    RAISE EXCEPTION 'manual_edit_detected_require_force' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.trade_records WHERE id = ANY(v_remove);

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, detail)
  VALUES (
    v_actor, 'signal_dupe_trade_fix', 'signal', p_signal_id,
    jsonb_build_object(
      'kept_id', v_keep,
      'removed_ids', to_jsonb(v_remove),
      'removed_count', array_length(v_remove, 1),
      'has_manual_edit', v_manual,
      'forced', p_force
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'kept_id', v_keep, 'removed_ids', to_jsonb(v_remove),
    'removed_count', array_length(v_remove, 1),
    'has_manual_edit', v_manual, 'executed', true
  );
END; $$;

REVOKE ALL ON FUNCTION public.admin_signal_dupe_trades_fix(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_signal_dupe_trades_fix(uuid, boolean, boolean) TO authenticated;
