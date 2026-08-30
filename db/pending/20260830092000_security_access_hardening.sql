-- ============================================================================
-- SECURITY_ACCESS_FIX (REV2) — item 3: view / table / function 存取收斂
--
-- 狀態：PENDING（本輪只產檔，未 apply）。
--
-- REV2 重寫理由（相對第一版）：
--   1. live DB 已由人工 transaction 10073021 / 10073064 先行修好一部分
--      （expert_limit_up_hits / checkup_knowledge_items 的 policy + anon 收回、
--        has_active_checkup_access 已建立並收回 anon）。本檔改為
--      **完全可重入（reentrant）**：對已修好的部分是 no-op，對未修的部分才生效，
--      套用後與 live 收斂到同一狀態。
--   2. 移除所有 definer metadata views（expert_limit_up_hits_public /
--      checkup_knowledge_items_public）。定義者權限的投影 view 會再開一條
--      繞過 RLS 的讀取面，且目前無任何前台消費端 → 不建立。
--   3. payment_providers_safe 維持 definer（不改 security_invoker）：
--      底層 public.payment_providers 只有一條
--      `Company admins full access providers`（TO authenticated,
--      has_role(auth.uid(),'company_admin')）policy，改成 invoker 會讓
--      anon / 一般會員在結帳頁讀到 0 列 → 直接壞掉。改以 scanner exception
--      紀錄（見檔尾與 security memory）。
--   4. 不重設 service_role：本檔不含任何 `REVOKE ... FROM service_role`，
--      GRANT 只做加法。
--   5. 不觸碰 pg_cron：本檔不含 cron.schedule / cron.alter_job，
--      SECURITY_CLOUD_STOP_BLEEDING 停用的 8 個 job 不會被改回。
--
-- 涵蓋：
--   A. expert_limit_up_hits    → owner/admin-only 讀取（live 已一致，保持重入）
--   B. checkup_knowledge_items → 具 checkup 存取權者才可讀全文（同上）
--   C. SECURITY DEFINER 函式：收回 anon/authenticated EXECUTE 或補 uid guard
--   D. payment_providers_safe：明示保留現況 + 例外理由
--
-- 全檔可逆（檔尾附 rollback）。不刪任何資料列。
-- ============================================================================

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- A. expert_limit_up_hits
--    舊：policy "Anyone can view limit up hits" USING (true) TO public
--        → 任何人可讀 entry_price / close_price / trade_record_id。
--    新：僅 company_admin 與該老師本人可讀。
--    消費端稽核：前台排行榜走 SECURITY DEFINER RPC
--                get_weekly_limit_up_leaderboard（不受影響）；
--                daily-snapshot edge function 以 service_role 寫入（不受影響）。
--    live 現況：已一致（policy 存在、anon 無 SELECT）→ 本段為 no-op。
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view limit up hits" ON public.expert_limit_up_hits;
DROP POLICY IF EXISTS "limit_up_hits_admin_or_owner_read" ON public.expert_limit_up_hits;

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

ALTER TABLE public.expert_limit_up_hits ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.expert_limit_up_hits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_limit_up_hits TO authenticated;
GRANT ALL ON public.expert_limit_up_hits TO service_role;

-- ---------------------------------------------------------------------------
-- B. checkup_knowledge_items
--    舊：policy "Anyone can read knowledge items" TO anon,authenticated
--        USING (is_active) → 付費知識庫全文任何人可整包抓走。
--    新：全文僅 company_admin 或「有效 checkup 存取權」使用者可讀。
--    消費端稽核：
--      - src/checkup/lib/knowledgeBase.js：查不到列即退成空 cache，
--        AI prompt 自動省略「知識庫參考」段落（既有 catch 路徑，不拋錯）。
--      - /company/knowledge-base/*：company_admin，維持全文。
--      - knowledge-* edge functions：service_role，不受 RLS 影響。
--    live 現況：已一致 → 本段為 no-op。
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
DROP POLICY IF EXISTS "knowledge_items_entitled_read" ON public.checkup_knowledge_items;

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

ALTER TABLE public.checkup_knowledge_items ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.checkup_knowledge_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkup_knowledge_items TO authenticated;
GRANT ALL ON public.checkup_knowledge_items TO service_role;

-- ---------------------------------------------------------------------------
-- C. SECURITY DEFINER 函式收斂
--    live 現況（2026-08-30 查證）：
--      已收斂：enqueue_institutional_backfill_universe / enqueue_backfill_jobs /
--              claim_backfill_jobs（anon+authenticated 皆無 EXECUTE）
--      仍開放：以下各支 → 本檔補齊。
--    所有 REVOKE 皆不含 service_role。
-- ---------------------------------------------------------------------------

-- C1. 純後端 / 排程專用（前台無任何呼叫端；edge function 走 service_role）
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

-- C2. 管理端函式：內部已有 has_role(company_admin) guard，僅收回 anon EXECUTE。
REVOKE EXECUTE ON FUNCTION public.admin_apply_fix_proposal(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_generate_fix_proposals(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_fix_proposal(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_fix_proposals(text) TO authenticated, service_role;

-- C3. enqueue_bsr_backfill：函式內已強制 auth.uid() 非空 + 擁有者/管理員檢查，
--     anon 呼叫本來就會 raise。收回 anon EXECUTE 讓拒絕發生在權限層（零行為變更）。
REVOKE EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_bsr_backfill(text, integer) TO authenticated, service_role;

-- C4. ensure_bsr_queued：原本完全沒有呼叫者身分檢查 → 匿名可無限灌 queue（成本放大）。
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

-- ---------------------------------------------------------------------------
-- D. payment_providers_safe — 明示保留現況（scanner exception）
--
--    掃描器會標記「view 缺 security_invoker」。此處為**刻意保留**：
--      * 底層 public.payment_providers 唯一 policy 是
--        `Company admins full access providers`（TO authenticated,
--         has_role(auth.uid(),'company_admin')）。
--      * payment_providers_safe 只投影非機密欄位（不含 config secrets），
--        供結帳頁列出可用支付方式；讀者是 anon / 一般會員。
--      * 改 security_invoker=true → 這些讀者拿到 0 列，結帳頁直接壞掉。
--    風險界線：view 不得新增任何機密欄位。若日後要加欄位，必須重新評估。
--    → 本檔刻意不執行：ALTER VIEW public.payment_providers_safe SET (security_invoker = true);
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.payment_providers_safe TO anon, authenticated;
GRANT ALL ON public.payment_providers_safe TO service_role;

-- ============================================================================
-- 本檔刻意不做（REV2 明列）
--   * 不建立 expert_limit_up_hits_public / checkup_knowledge_items_public
--     等 definer metadata view。
--   * 不改 payment_providers_safe 的 security_invoker（見 D）。
--   * 不含任何 REVOKE ... FROM service_role。
--   * 不含任何 cron.schedule / cron.alter_job / cron.unschedule。
--
-- ROLLBACK（若需回復，逐段執行）
--   DROP POLICY IF EXISTS "limit_up_hits_admin_or_owner_read" ON public.expert_limit_up_hits;
--   CREATE POLICY "Anyone can view limit up hits" ON public.expert_limit_up_hits FOR SELECT USING (true);
--   GRANT SELECT ON public.expert_limit_up_hits TO anon;
--   DROP POLICY IF EXISTS "knowledge_items_entitled_read" ON public.checkup_knowledge_items;
--   CREATE POLICY "Anyone can read knowledge items" ON public.checkup_knowledge_items
--     FOR SELECT TO anon, authenticated USING (is_active = true);
--   GRANT SELECT ON public.checkup_knowledge_items TO anon;
--   GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;  -- C1/C2/C3 逐一還原
--   （ensure_bsr_queued 還原：移除開頭 auth.uid() guard 區塊）
-- ============================================================================
