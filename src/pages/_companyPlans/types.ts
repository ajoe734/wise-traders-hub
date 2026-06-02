export type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface OverrideRow {
  id: string;
  pct_platform: number;
  pct_expert: number;
  is_active: boolean;
  notes: string | null;
}

export interface PlanRow {
  id: string;
  expert_id: string;
  name: string;
  description: string | null;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  features: any;
  is_active: boolean;
  review_status: ReviewStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  experts: { name: string; slug: string; role: string } | null;
  override: OverrideRow | null;
}

export interface DefaultRule { pct_platform: number; pct_expert: number; }

export interface SplitForm {
  pct_platform: number;
  pct_expert: number;
  is_active: boolean;
  notes: string;
}

export const STATUS_LABEL: Record<ReviewStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
  pending: { label: '待審核', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400' },
  approved: { label: '已核准', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400' },
  rejected: { label: '已退回', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

export const PLAN_TYPE_LABEL: Record<string, string> = {
  analyst_signal_l1: '即時訊號',
  analyst_signal_diag_l2: '訊號 + 持股健檢',
  mentor_weekly_journal: 'T+7 週記教學',
};

export const CROSS_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'has_checkup_basic_discount_on_expert', label: '已訂健檢 Basic → 訂閱方案折扣', hint: '會員在持有健檢 Basic 期間訂閱分析師方案時自動折抵' },
  { key: 'has_checkup_pro_discount_on_expert', label: '已訂健檢 Pro → 訂閱方案折扣', hint: '會員在持有健檢 Pro 期間訂閱分析師方案時自動折抵' },
  { key: 'has_expert_discount_on_checkup_basic', label: '已訂方案 → 健檢 Basic 折扣', hint: '會員在持有任一訂閱方案期間購買健檢 Basic 時自動折抵' },
  { key: 'has_expert_discount_on_checkup_pro', label: '已訂方案 → 健檢 Pro 折扣', hint: '會員在持有任一訂閱方案期間購買健檢 Pro 時自動折抵' },
];
