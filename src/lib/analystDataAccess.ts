/**
 * 分析師資料存取邏輯
 *
 * 以下函數從 admin 頁面提取，供 Vitest 測試。
 * DB 端 RLS 策略（expert_id IN (SELECT id FROM experts WHERE user_id = auth.uid())）
 * 確保各分析師僅能存取自身資料。
 *
 * 對應 admin 頁面：
 *   fetchAnalystSignals      → src/pages/admin/Signals.tsx
 *   fetchAnalystTradeRecords → src/pages/admin/Dashboard.tsx
 *   fetchAnalystSubscribers  → src/pages/admin/Subscribers.tsx
 *   fetchAnalystTemplates    → src/pages/admin/Signals.tsx / ReasonTemplates.tsx
 */

// ── fetchAnalystSignals ───────────────────────────────────────────────────────

export interface FetchAnalystSignalsResult {
  signals: any[];
  error: string | null;
}

/**
 * 查詢指定 expert_id 的訊號列表。
 * RLS 在 DB 端保證只有 expert owner 能取得資料；
 * 此函數驗證 client 端正確傳入 expert_id 過濾條件。
 */
export async function fetchAnalystSignals(
  supabase: { from: (table: string) => any },
  expertId: string,
): Promise<FetchAnalystSignalsResult> {
  const { data, error } = await supabase
    .from('expert_signals')
    .select('*')
    .eq('expert_id', expertId)
    .order('created_at', { ascending: false });

  return { signals: data ?? [], error: error?.message ?? null };
}

// ── fetchAnalystTradeRecords ──────────────────────────────────────────────────

export interface FetchAnalystTradeRecordsResult {
  records: any[];
  error: string | null;
}

/**
 * 查詢指定 expert_id 的交易紀錄。
 */
export async function fetchAnalystTradeRecords(
  supabase: { from: (table: string) => any },
  expertId: string,
): Promise<FetchAnalystTradeRecordsResult> {
  const { data, error } = await supabase
    .from('trade_records')
    .select('id, instrument, status, entry_price, exit_price, pnl_percent')
    .eq('expert_id', expertId);

  return { records: data ?? [], error: error?.message ?? null };
}

// ── fetchAnalystSubscribers ───────────────────────────────────────────────────

export interface FetchAnalystSubscribersResult {
  subscriptions: any[];
  error: string | null;
}

/**
 * 查詢指定 expert_id 的訂閱者列表：
 *   先取得 expert 所有 plan_id，再查 member_subscriptions。
 */
export async function fetchAnalystSubscribers(
  supabase: { from: (table: string) => any },
  expertId: string,
): Promise<FetchAnalystSubscribersResult> {
  const { data: plans, error: planErr } = await supabase
    .from('expert_plans')
    .select('id')
    .eq('expert_id', expertId);

  if (planErr) return { subscriptions: [], error: planErr.message };

  const planIds = (plans ?? []).map((p: any) => p.id);
  if (planIds.length === 0) return { subscriptions: [], error: null };

  const { data, error } = await supabase
    .from('member_subscriptions')
    .select('*, expert_plans(name)')
    .in('plan_id', planIds)
    .order('created_at', { ascending: false });

  return { subscriptions: data ?? [], error: error?.message ?? null };
}

// ── fetchAnalystTemplates ─────────────────────────────────────────────────────

export interface FetchAnalystTemplatesResult {
  signalTemplates: any[];
  reasonTemplates: any[];
  error: string | null;
}

/**
 * 查詢指定 expert_id 的訊號範本與理由範本。
 */
export async function fetchAnalystTemplates(
  supabase: { from: (table: string) => any },
  expertId: string,
): Promise<FetchAnalystTemplatesResult> {
  const { data: signalTpl, error: sigErr } = await supabase
    .from('expert_signal_templates')
    .select('id, instrument, action')
    .eq('expert_id', expertId);

  if (sigErr) return { signalTemplates: [], reasonTemplates: [], error: sigErr.message };

  const { data: reasonTpl, error: reasonErr } = await supabase
    .from('expert_reason_templates')
    .select('id, content')
    .eq('expert_id', expertId);

  return {
    signalTemplates: signalTpl ?? [],
    reasonTemplates: reasonTpl ?? [],
    error: reasonErr?.message ?? null,
  };
}
