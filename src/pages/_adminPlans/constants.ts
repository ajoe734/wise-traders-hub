import type { PlanType, ReviewStatus } from '@/hooks/admin/useAdminPlansData';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
  pending: {
    label: '待審核',
    cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400',
  },
  approved: {
    label: '已核准',
    cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400',
  },
  rejected: { label: '已退回', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
};

export const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  analyst_signal_l1: '即時訊號',
  analyst_signal_diag_l2: '訊號 + 持股健檢',
  mentor_weekly_journal: 'T+7 週記教學',
};

export const ADVISOR_PLAN_TYPES: PlanType[] = ['analyst_signal_l1', 'analyst_signal_diag_l2'];
export const MENTOR_PLAN_TYPES: PlanType[] = ['mentor_weekly_journal'];
