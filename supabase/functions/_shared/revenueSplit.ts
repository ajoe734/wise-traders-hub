/**
 * 分潤與跨產品折扣計算（Single Source of Truth）
 * - 分潤規則：標準 vs 被導流（有 utm_source 且非自家流量）
 * - 跨產品折扣：被折方專家承擔；分潤基數 = 實收 - 折扣
 * - 健檢商品：平台 100%
 */

export interface SplitRule {
  pct_platform: number;
  pct_expert: number;
  pct_channel: number;
}

export interface SplitInput {
  productKind: 'expert_plan' | 'checkup';
  gross: number;            // 原價
  discount: number;         // 折扣金額
  discountSource?: string | null; // e.g. 'cross_checkup_basic'
  attribution?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    ref_code?: string | null;
  } | null;
  expertOverride?: SplitRule | null;
  channelOverride?: SplitRule | null;
  defaults: {
    standard: SplitRule;        // 無 utm
    attributed: SplitRule;      // 有 utm
    checkup: SplitRule;         // 健檢
  };
}

export interface SplitOutput {
  net: number;
  platform_amount: number;
  expert_amount: number;
  channel_reserve: number;
  rule_source: 'expert_override' | 'channel_override' | 'attributed_default' | 'standard_default' | 'checkup_default';
  rule_snapshot: SplitRule;
}

const OWN_SOURCES = new Set(['legendflow', 'organic', 'direct', '']);

export function isAttributed(attr: SplitInput['attribution']): boolean {
  if (!attr) return false;
  const src = (attr.utm_source || '').toLowerCase().trim();
  if (!src) return false;
  return !OWN_SOURCES.has(src);
}

export function calcSplit(input: SplitInput): SplitOutput {
  const net = Math.max(0, input.gross - input.discount);

  // 健檢：平台 100%
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

  // 決定規則
  const attributed = isAttributed(input.attribution);
  let rule: SplitRule;
  let source: SplitOutput['rule_source'];

  if (input.channelOverride && attributed) {
    rule = input.channelOverride;
    source = 'channel_override';
  } else if (input.expertOverride) {
    rule = input.expertOverride;
    source = 'expert_override';
  } else if (attributed) {
    rule = input.defaults.attributed;
    source = 'attributed_default';
  } else {
    rule = input.defaults.standard;
    source = 'standard_default';
  }

  const platform = Math.round((net * rule.pct_platform) / 100);
  const channel = Math.round((net * rule.pct_channel) / 100);
  const expert = net - platform - channel; // 殘差給專家避免湊不到 100%

  return {
    net,
    platform_amount: platform,
    expert_amount: Math.max(0, expert),
    channel_reserve: channel,
    rule_source: source,
    rule_snapshot: rule,
  };
}

/**
 * 跨產品折扣：依使用者目前持有訂閱推算可享折扣
 * 規則由 payment_settings.cross_discounts 提供：
 *   { has_checkup_basic_discount_on_expert: 100, has_checkup_pro_discount_on_expert: 200,
 *     has_expert_discount_on_checkup_basic: 100, has_expert_discount_on_checkup_pro: 200 }
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
 * 月→年升級按比例補價
 * 計算：剩餘月份未使用價值 = 月費 * (剩餘秒數 / 30天秒數)
 *      應補金額 = 年費 - 剩餘未使用價值
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

  return {
    standard: map.get('split_standard') || { pct_platform: 55, pct_expert: 45, pct_channel: 0 },
    attributed: map.get('split_attributed') || { pct_platform: 35, pct_expert: 45, pct_channel: 20 },
    checkup: map.get('split_checkup') || { pct_platform: 100, pct_expert: 0, pct_channel: 0 },
    crossDiscounts: map.get('cross_discounts') || {
      has_checkup_basic_discount_on_expert: 100,
      has_checkup_pro_discount_on_expert: 200,
      has_expert_discount_on_checkup_basic: 100,
      has_expert_discount_on_checkup_pro: 200,
    },
  };
}
