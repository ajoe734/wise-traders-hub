/**
 * PublishPort — 週記發布流程唯一的外部握手接縫（seam）。
 *
 * pipeline.ts 只依賴這個介面，不認識 supabase-js / fetch，
 * 讓每個階段都能用 in-memory fake 獨立驗證。
 */

export interface PendingSignal {
  id: string;
  expert_id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  teaching_topic: string | null;
  overall_summary: string | null;
  published_at: string | null;
  batch_id: string | null;
  executed_at: string | null;
}

export interface ExpertRow {
  id: string;
  user_id: string | null;
  name: string | null;
  slug?: string | null;
  asset_class?: string | null;
}

export interface LineBinding { line_user_id: string; user_id: string }
export interface ActiveSubscription { user_id: string; plan_id: string; canceled_at: string | null; expires_at: string }
export interface LineChannel { channel_access_token: string | null; is_active: boolean | null }
export interface NotificationRow {
  user_id: string;
  title: string;
  body: string;
  type: string;
  link: string | null;
  download_url?: string;

}

export interface MulticastResult { ok: boolean; status: number; body?: string }

export type EmitFn = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  ctx?: Record<string, unknown>,
) => void;

export interface PublishPort {
  // ── scope ────────────────────────────────────────────────────────────
  listExperts(): Promise<ExpertRow[]>;
  listExpertsByIds(ids: string[]): Promise<ExpertRow[]>;
  getExpert(id: string): Promise<ExpertRow | null>;

  // ── publish ──────────────────────────────────────────────────────────
  listPendingSignals(expertIds: string[] | null): Promise<PendingSignal[]>;
  /** 失敗必須 throw，pipeline 依賴 throw 做 transient retry 與分類。 */
  markSignalPublished(signalId: string, market: string): Promise<void>;
  logUnitLockViolation(payload: Record<string, unknown>): Promise<void>;
  insertNotifications(rows: NotificationRow[]): Promise<void>;

  // ── trade_signals / user_performances sync ───────────────────────────
  closeOpenTradeSignal(userId: string, symbol: string): Promise<void>;
  deleteUserPerformance(userId: string, symbol: string): Promise<void>;
  hasOpenTradeRecords(expertId: string, stockCode: string): Promise<boolean>;
  hasOpenTradeSignal(userId: string, symbol: string): Promise<boolean>;
  openTradeSignalWithPerformance(args: {
    userId: string;
    symbol: string;
    name: string | null;
    entryPrice: number;
  }): Promise<void>;

  // ── LINE push ────────────────────────────────────────────────────────
  getLineChannel(expertId: string): Promise<LineChannel | null>;
  listActiveBindings(expertId: string): Promise<LineBinding[]>;
  listActiveSubscriptions(userIds: string[]): Promise<ActiveSubscription[]>;
  listExpertPlanIds(expertId: string): Promise<string[]>;
  calcExpertPerformance(expertId: string): Promise<unknown>;
  sendLineMulticast(token: string, to: string[], messages: unknown[]): Promise<MulticastResult>;

  // ── idempotency（推播冪等）────────────────────────────────────────────
  /**
   * 先佔位再送出：回傳「這次真的佔到、尚未送過」的收件人。
   * 已存在收據者不會回傳 → 重跑或 90s abort 後不會重複推播。
   */
  claimPushRecipients(args: {
    dedupeKey: string;
    kind: string;
    expertId: string;
    recipients: string[];
  }): Promise<string[]>;
  /** 送出失敗時釋放佔位，讓下一次重跑可以補送。 */
  releasePushClaims(dedupeKey: string, recipients: string[]): Promise<void>;

  now(): Date;
}
