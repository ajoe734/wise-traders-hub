-- ============================================================================
-- SECURITY_ACCESS_FIX — item 3: view / table / function 存取收斂
--
-- 狀態：PENDING（本輪只產檔，未 apply）。
-- 套用方式：核准後由 migration 工具原文送出，會自動落成正式 migration 檔。
-- 內容全部可逆（檔尾附 rollback）。不動 cron 排程、不刪任何資料列。
--
-- 涵蓋：
--   A. payment_providers_safe 改 security_invoker
--   B. expert_limit_up_hits    → metadata-only public view + 收緊原表
--   C. checkup_knowledge_items → metadata-only public view + 收緊原表（付費內容）
--   D. SECURITY DEFINER 函式：加 uid guard 或收回 anon EXECUTE
--
-- 備註：expert_line_channels 本身是 table，對外暴露的是 view
--       public.expert_line_channels_public，該 view 已是 security_invoker=true
--       （稽核確認），本次無需變更。
-- ============================================================================

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- A. payment_providers_safe：改為 invoker 權限（唯一缺 security_invoker 的 view）
-- ---------------------------------------------------------------------------
ALTER VIEW public.payment_providers_safe SET (security_invoker = true);

-- 該 view 僅暴露非機密欄位（不含 config secrets），維持既有讀取角色。
GRANT SELECT ON public.payment_providers_safe TO anon, authenticated;
GRANT ALL ON public.payment_providers_safe TO service_role;

-- ---------------------------------------------------------------------------
-- B. expert_limit_up_hits
--    現況：policy "Anyone can view limit up hits" USING (true) TO public
--          → 任何人可讀 entry_price / close_price / trade_record_id。
--    改為：原表僅 company_admin 與該老師本人可讀；對外只留 metadata view。
--    消費端稽核：前台無任何直接 select（排行榜走 SECURITY DEFINER RPC
--                get_weekly_limit_up_leaderboard，不受影響）；
--                daily-snapshot edge function 以 service_role 寫入，不受影響。
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view limit up hits" ON public.expert_limit_up_hits;

CREATE POLICY "limit_up_hits_admin_or_owner_read"
  ON public.expert_limit_up_hits
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'company_admin')
    OR EXISTS (
      SELECT 1 FROM public.experts e
      WHERE e.id = expert_limit_up_hits.expert_id
        AND e.user_id = auth.uid()
    )
  );

REVOKE SELECT ON public.expert_limit_up_hits FROM anon;
GRANT SELECT ON public.expert_limit_up_hits TO authenticated;
GRANT ALL ON public.expert_limit_up_hits TO service_role;

-- metadata-only：不含 entry_price / close_price / trade_record_id
CREATE OR REPLACE VIEW public.expert_limit_up_hits_public AS
  SELECT
    h.expert_id,
    h.symbol,
    h.instrument,
    h.trade_date
  FROM public.expert_limit_up_hits h
  JOIN public.experts e ON e.id = h.expert_id AND e.status = 'active';

COMMENT ON VIEW public.expert_limit_up_hits_public IS
  'Marketing-safe projection of expert_limit_up_hits: no prices, no trade_record_id. Definer-rights on purpose.';

GRANT SELECT ON public.expert_limit_up_hits_public TO anon, authenticated;
GRANT ALL ON public.expert_limit_up_hits_public TO service_role;

-- ---------------------------------------------------------------------------
-- C. checkup_knowledge_items
--    現況：policy "Anyone can read knowledge items" TO anon,authenticated
--          USING (is_active) → 付費知識庫全文（fact/interpretation/action/
--          lessons/trigger_condition/expected_outcome）任何人可整包抓走。
--    改為：全文僅 company_admin 或「有效 checkup 存取權」使用者可讀；
--          對外只留不含全文的 metadata view。
--    消費端稽核：
--      - src/checkup/lib/knowledgeBase.js：查不到列時本來就退成空 cache，
--        AI prompt 自動省略「知識庫參考」段落，不會拋錯（既有 catch 路徑）。
--      - /company/knowledge-base/*：company_admin 身分，維持全文。
--      - knowledge-daily-scheduler / knowledge-backtest 等 edge function：
--        service_role，不受 RLS 影響。
-- ---------------------------------------------------------------------------

-- 有效 checkup 存取權 = 有效訂閱 或 未過期 entitlement（聯集，避免斷訂閱）
CREATE OR REPLACE FUNCTION public.has_active_checkup_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.checkup_subscriptions s
      WHERE s.user_id = _user_id
        AND s.status = 'active'
        AND (s.expires_at IS NULL OR s.expires_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM public.checkup_entitlements ce
      WHERE ce.user_id = _user_id
        AND ce.is_active = true
        AND (ce.expires_at IS NULL OR ce.expires_at > now())
    )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.has_active_checkup_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_checkup_access(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can read knowledge items" ON public.checkup_knowledge_items;

CREATE POLICY "knowledge_items_entitled_read"
  ON public.checkup_knowledge_items
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND (
      public.has_role(auth.uid(), 'company_admin')
      OR public.has_active_checkup_access(auth.uid())
    )
  );

REVOKE SELECT ON public.checkup_knowledge_items FROM anon;
GRANT SELECT ON public.checkup_knowledge_items TO authenticated;
GRANT ALL ON public.checkup_knowledge_items TO service_role;

-- metadata-only：標題/分類/標籤/統計，無全文內容
CREATE OR REPLACE VIEW public.checkup_knowledge_items_public AS
  SELECT
    k.id,
    k.item_id,
    k.category,
    k.title,
    k.tags,
    k.industry_tags,
    k.time_horizon,
    k.source_type,
    k.win_rate,
    k.sample_size,
    k.confidence,
    k.lifecycle_status,
    k.updated_at
  FROM public.checkup_knowledge_items k
  WHERE k.is_active = true
    AND k.lifecycle_status IN ('active', 'rescue');

COMMENT ON VIEW public.checkup_knowledge_items_public IS
  'Marketing-safe projection: titles/tags/stats only. Never expose fact/interpretation/action/lessons here.';

GRANT SELECT ON public.checkup_knowledge_items_public TO anon, authenticated;
GRANT ALL ON public.checkup_knowledge_items_public TO service_role;

-- ---------------------------------------------------------------------------
-- D. SECURITY DEFINER 函式收斂
-- ---------------------------------------------------------------------------

-- D1. 純後端 / 排程專用（前台無任何呼叫端；edge function 走 service_role）
--     → 收回 anon 與 authenticated 的 EXECUTE。
REVOKE EXECUTE ON FUNCTION public.enqueue_institutional_backfill_universe() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_all_active_tw_holdings_bsr(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_institutional_new_stock(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_backfill_jobs(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_backfill_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_institutional_new_stock(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bsr_snapshot_claim(date, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finmind_admit(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finmind_admit_v2(text, text, text, numeric, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_institutional_backfill_universe() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_all_active_tw_holdings_bsr(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_institutional_new_stock(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_backfill_jobs(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_backfill_jobs(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_institutional_new_stock(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_snapshot_claim(date, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finmind_admit(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finmind_admit_v2(text, text, text, numeric, boolean) TO service_role;

-- D2. 管理端函式：內部已有 has_role(company_admin) guard，僅收回 anon EXECUTE。
REVOKE EXECUTE ON FUNCTION public.admin_apply_fix_proposal(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_generate_fix_proposals(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_fix_proposal(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_fix_proposals(text) TO authenticated, service_role;

-- D3. enqueue_bsr_backfill：函式內已強制 auth.uid() 非空 + 擁有者/管理員檢查，
--     anon 呼叫本來就會 raise。收回 anon EXECUTE 讓拒絕發生在權限層（零行為變更）。
REVOKE EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, integer) TO authenticated, service_role;

-- D4. ensure_bsr_queued：原本完全沒有呼叫者身分檢查 → 匿名可無限灌 queue（成本放大）。
--     加 uid guard；維持 jsonb 回傳形狀（不 raise），前台既有 'ineligible' 分支即可吸收。
CREATE OR REPLACE FUNCTION public.ensure_bsr_queued(p_stock_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_elig jsonb;
  v_today date;
  v_active record;
  v_done record;
  v_failure record;
  v_next timestamptz := now();
  v_reason text;
  v_inserted integer := 0;
  v_raw_rows integer := 0;
  v_done_threshold integer := 5;
  v_fake_done boolean := false;
BEGIN
  -- SECURITY: 匿名呼叫者不得推進佇列（成本放大面）。回傳與 ineligible 同形狀。
  IF auth.uid() IS NULL AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object(
      'skipped', 'unauthenticated',
      'eligible', false,
      'created', false,
      'status', 'ineligible');
  END IF;

  IF NOT private_bsr.ingest_allowed() THEN
    RETURN jsonb_build_object(
      'skipped', 'bsr_provider_unsupported',
      'eligible', false,
      'created', false,
      'status', 'suppressed');
  END IF;
  v_elig := public.tw_bsr_eligibility(p_stock_id);
  IF COALESCE((v_elig->>'eligible')::boolean, false) = false THEN
    RETURN v_elig || jsonb_build_object('created', false, 'status', 'ineligible');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bsr_queue:' || p_stock_id));

  v_today := (now() AT TIME ZONE 'Asia/Taipei')::date;

  SELECT status, trade_date, next_run_at INTO v_active
    FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND status IN ('pending','running')
    ORDER BY updated_at DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'eligible', true,
      'created', false,
      'status', v_active.status,
      'trade_date', v_active.trade_date,
      'next_run_at', v_active.next_run_at
    );
  END IF;

  SELECT trade_date, updated_at INTO v_done
    FROM public.tw_bsr_sync_queue
    WHERE stock_id = p_stock_id AND trade_date = v_today AND status = 'done'
    ORDER BY updated_at DESC
    LIMIT 1;
  IF FOUND THEN
    SELECT count(*) INTO v_raw_rows
      FROM public.tw_bsr_daily
      WHERE stock_id = p_stock_id AND trade_date = v_today;

    IF v_raw_rows >= v_done_threshold THEN
      RETURN jsonb_build_object(
        'eligible', true,
        'created', false,
        'status', 'completed',
        'trade_date', v_done.trade_date,
        'completed_at', v_done.updated_at,
        'raw_rows', v_raw_rows
      );
    END IF;

    v_fake_done := true;
  END IF;

  SELECT next_retry_at, reason INTO v_failure
    FROM public.tw_bsr_fetch_failures
    WHERE stock_id = p_stock_id AND resolved_at IS NULL
    ORDER BY trade_date DESC
    LIMIT 1;
  IF FOUND AND v_failure.next_retry_at IS NOT NULL AND v_failure.next_retry_at > now() THEN
    v_next := v_failure.next_retry_at;
    v_reason := v_failure.reason;
  END IF;

  INSERT INTO public.tw_bsr_sync_queue
    (stock_id, trade_date, priority, status, next_run_at, enqueued_by, correlation_id, post_close_only)
  VALUES
    (p_stock_id, v_today, 1, 'pending', v_next, 'ensure_bsr_queued', gen_random_uuid(), false)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'eligible', true,
    'created', v_inserted > 0,
    'status', 'pending',
    'trade_date', v_today,
    'next_run_at', v_next,
    'respected_backoff_reason', v_reason,
    'requeued_fake_done', v_fake_done,
    'raw_rows', v_raw_rows,
    'required_raw_rows', v_done_threshold
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ensure_bsr_queued(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_bsr_queued(text) TO anon, authenticated, service_role;

-- ============================================================================
-- ROLLBACK（若需回復，逐段執行）
--   ALTER VIEW public.payment_providers_safe SET (security_invoker = false);
--   DROP VIEW IF EXISTS public.expert_limit_up_hits_public;
--   DROP VIEW IF EXISTS public.checkup_knowledge_items_public;
--   DROP POLICY IF EXISTS "limit_up_hits_admin_or_owner_read" ON public.expert_limit_up_hits;
--   CREATE POLICY "Anyone can view limit up hits" ON public.expert_limit_up_hits FOR SELECT USING (true);
--   GRANT SELECT ON public.expert_limit_up_hits TO anon;
--   DROP POLICY IF EXISTS "knowledge_items_entitled_read" ON public.checkup_knowledge_items;
--   CREATE POLICY "Anyone can read knowledge items" ON public.checkup_knowledge_items
--     FOR SELECT TO anon, authenticated USING (is_active = true);
--   GRANT SELECT ON public.checkup_knowledge_items TO anon;
--   GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;  -- D1/D2/D3 逐一還原
--   （ensure_bsr_queued 還原：移除開頭 auth.uid() guard 區塊）
-- ============================================================================
