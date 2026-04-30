/**
 * 統一的審計日記寫入工具。
 *
 * 規範：
 * - action 採 `namespace.verb` 格式：plan.approve / payment.refund / setting.split_update
 * - detail 結構：{ before?, after?, context?: { reason?, ... } }
 * - 系統 cron 不要走這裡，請寫入 system_jobs_log
 */
import { supabase } from '@/integrations/supabase/client';

export type AuditNamespace =
  | 'plan'
  | 'payment'
  | 'subscription'
  | 'analyst'
  | 'announcement'
  | 'signal'
  | 'setting'
  | 'remittance';

export interface LogAdminActionParams {
  /** namespace.verb，例如 plan.approve */
  action: string;
  /** 影響的資源類型（資料表名或邏輯名） */
  targetType?: string;
  /** 影響的資源 ID */
  targetId?: string | null;
  /** 變更內容：建議 { before, after, context } */
  detail?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
    context?: Record<string, any>;
    [k: string]: any;
  };
}

export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const actor_id = userData.user?.id;
    if (!actor_id) {
      console.warn('[auditLog] no auth user, skip', params.action);
      return;
    }
    const { error } = await supabase.from('audit_logs').insert({
      actor_id,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      detail: params.detail ?? {},
    });
    if (error) {
      console.warn('[auditLog] insert failed', params.action, error.message);
    }
  } catch (e) {
    console.warn('[auditLog] exception', e);
  }
}

/** 把人類看不懂的 action key 翻成中文描述 */
export const ACTION_LABELS: Record<string, string> = {
  // plan.*
  'plan.approve': '核准方案',
  'plan.reject': '退回方案',
  'plan.toggle_active': '上下架方案',
  'plan.split_override_upsert': '更新方案分潤覆寫',
  'plan.split_override_remove': '刪除方案分潤覆寫',
  'plan.cross_discount_update': '更新跨產品折扣',
  // setting.*
  'setting.split_default_update': '更新預設分潤比例',
  'setting.payment_provider_toggle': '切換金流工具啟用',
  'setting.payment_provider_create': '新增金流工具',
  'setting.remittance_account_update': '更新匯款帳戶資訊',
  // payment.*
  'payment.refund': '執行退款',
  // subscription.*
  'subscription.admin_adjust': '管理員調整訂閱',
  'subscription.cancel': '取消訂閱',
  // remittance.*
  'remittance.confirm': '確認匯款入帳',
  'remittance.reject': '退回匯款訂單',
  // analyst.*
  'analyst.create': '建立分析師',
  'analyst.suspend': '停用分析師',
  'analyst.activate': '啟用分析師',
  'analyst.update_credentials': '更新分析師登入資訊',
  'analyst.line_channel_create': '新增分析師 LINE 頻道',
  'analyst.line_channel_update': '更新分析師 LINE 頻道',
  // announcement.*
  'announcement.publish': '發布系統公告',
  'announcement.unpublish': '取消發布公告',
  'announcement.delete': '刪除系統公告',
  // signal.*
  'signal.admin_takedown': '管理員下架訊號',
};

export function formatActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** 把 target_type 翻成中文 */
export const TARGET_TYPE_LABELS: Record<string, string> = {
  expert_plan: '訂閱方案',
  payment_settings: '收款設定',
  payment_providers: '金流工具',
  payment_transactions: '交易',
  member_subscriptions: '訂閱',
  remittance_orders: '匯款訂單',
  experts: '分析師',
  announcements: '公告',
  expert_signals: '訊號',
  plan_split_overrides: '分潤覆寫',
};

export function formatTargetType(t?: string | null): string {
  if (!t) return '-';
  return TARGET_TYPE_LABELS[t] ?? t;
}
