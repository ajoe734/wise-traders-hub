/**
 * 分潤與跨產品折扣計算（Single Source of Truth）
 *
 * 架構（v2，已停用導流分潤）：
 *   - 健檢商品：平台 100%
 *   - 一般方案：plan_split_overrides[plan_id] 覆寫優先，否則用全站 split_standard
 *   - attribution（utm_source 等）僅作行銷追蹤紀錄，不影響分潤
 */

export interface SplitRule {
  pct_platform: number;
  pct_expert: number;
}

export interface SplitInput {
  productKind: 'expert_plan' | 'checkup';
  gross: number;            // 原價
  discount: number;         // 折扣金額
  discountSource?: string | null;
  /** 行銷追蹤用（不影響分潤計算，但會記錄到 revenue_splits.utm_snapshot） */
  attribution?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    ref_code?: string | null;
  } | null;
  /** 來自 plan_split_overrides，優先於 standard default */
  planOverride?: SplitRule | null;
  defaults: {
    standard: SplitRule;
    checkup: SplitRule;
  };
}

export interface SplitOutput {
  net: number;
  platform_amount: number;
  expert_amount: number;
  channel_reserve: number;
  rule_source: 'plan_override' | 'standard_default' | 'checkup_default';
  rule_snapshot: SplitRule;
}

export function calcSplit(input: SplitInput): SplitOutput {
  const net = Math.max(0, input.gross - input.discount);

  if (input.productKind === 'checkup') {
    return {
      net,
      platform_amount: net,
      expert_amount: 0,
      channel_reserve: 0,
      rule_source: 'checkup_default',
      rule_snapshot: input.defaults.checkup,
    };
  }

  const rule = input.planOverride ?? input.defaults.standard;
  const source: SplitOutput['rule_source'] = input.planOverride ? 'plan_override' : 'standard_default';

  const platform = Math.round((net * rule.pct_platform) / 100);
  const expert = net - platform; // 殘差給 expert

  return {
    net,
    platform_amount: platform,
    expert_amount: Math.max(0, expert),
    channel_reserve: 0,
    rule_source: source,
    rule_snapshot: rule,
  };
}

/**
 * 跨產品折扣（不變）
 */
export interface CrossDiscountInput {
  productKind: 'expert_plan' | 'checkup';
  checkupTier?: 'basic' | 'pro' | null;
  hasActiveExpert: boolean;
  activeCheckupTier: 'basic' | 'pro' | null;
  rules: Record<string, number>;
}

export function calcCrossDiscount(input: CrossDiscountInput): { amount: number; reason: string | null } {
  const r = input.rules || {};
  if (input.productKind === 'expert_plan') {
    if (input.activeCheckupTier === 'pro' && r.has_checkup_pro_discount_on_expert) {
      return { amount: r.has_checkup_pro_discount_on_expert, reason: 'cross_checkup_pro' };
    }
    if (input.activeCheckupTier === 'basic' && r.has_checkup_basic_discount_on_expert) {
      return { amount: r.has_checkup_basic_discount_on_expert, reason: 'cross_checkup_basic' };
    }
  } else if (input.productKind === 'checkup') {
    if (input.hasActiveExpert) {
      if (input.checkupTier === 'pro' && r.has_expert_discount_on_checkup_pro) {
        return { amount: r.has_expert_discount_on_checkup_pro, reason: 'cross_expert_on_pro' };
      }
      if (input.checkupTier === 'basic' && r.has_expert_discount_on_checkup_basic) {
        return { amount: r.has_expert_discount_on_checkup_basic, reason: 'cross_expert_on_basic' };
      }
    }
  }
  return { amount: 0, reason: null };
}

/**
 * 月→年升級按比例補價（不變）
 */
export function calcUpgradeProration(opts: {
  monthlyPrice: number;
  yearlyPrice: number;
  startedAt: Date;
  expiresAt: Date;
  now?: Date;
}): { creditAmount: number; chargeAmount: number } {
  const now = opts.now ?? new Date();
  const totalMs = opts.expiresAt.getTime() - opts.startedAt.getTime();
  const remainMs = Math.max(0, opts.expiresAt.getTime() - now.getTime());
  if (totalMs <= 0) return { creditAmount: 0, chargeAmount: opts.yearlyPrice };
  const ratio = Math.min(1, remainMs / totalMs);
  const credit = Math.round(opts.monthlyPrice * ratio);
  return {
    creditAmount: credit,
    chargeAmount: Math.max(0, opts.yearlyPrice - credit),
  };
}

/** 從 payment_settings 取得預設規則 */
export async function loadPaymentDefaults(supabase: any): Promise<SplitInput['defaults'] & { crossDiscounts: Record<string, number> }> {
  const { data } = await supabase
    .from('payment_settings')
    .select('key, value');

  const map = new Map<string, any>();
  (data || []).forEach((row: any) => map.set(row.key, row.value));

  const standardRaw = map.get('split_standard') || { pct_platform: 55, pct_expert: 45 };
  const checkupRaw = map.get('split_checkup') || { pct_platform: 100, pct_expert: 0 };

  return {
    standard: { pct_platform: standardRaw.pct_platform ?? 55, pct_expert: standardRaw.pct_expert ?? 45 },
    checkup: { pct_platform: checkupRaw.pct_platform ?? 100, pct_expert: checkupRaw.pct_expert ?? 0 },
    crossDiscounts: map.get('cross_discounts') || {
      has_checkup_basic_discount_on_expert: 100,
      has_checkup_pro_discount_on_expert: 200,
      has_expert_discount_on_checkup_basic: 100,
      has_expert_discount_on_checkup_pro: 200,
    },
  };
}
