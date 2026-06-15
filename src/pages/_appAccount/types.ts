export interface DbSubscription {
  id: string;
  plan_id: string;
  status: string;
  auto_renew: boolean;
  billing_cycle: 'monthly' | 'yearly' | string;
  started_at: string;
  expires_at: string | null;
  canceled_at: string | null;
  plan: {
    id: string;
    name: string;
    plan_type: string;
    price_monthly: number;
    price_yearly: number | null;
  };
  expert: {
    id: string;
    slug: string;
    name: string;
    role: string;
    avatar_url: string | null;
  };
}

export interface ExpertLineRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  avatar_url: string | null;
  line_oa_id?: string | null;
  qr_code_url?: string | null;
  channel_name?: string | null;
}

export const getPlanTypeLabel = (planType: string) => {
  switch (planType) {
    case 'analyst_signal_l1': return '跟單派 基礎';
    case 'analyst_signal_diag_l2': return '跟單派 進階';
    case 'mentor_weekly_journal': return '修煉派';
    default: return planType;
  }
};

export const isAdvisorPlan = (planType: string) => planType !== 'mentor_weekly_journal';
