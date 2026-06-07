/**
 * Server-side order amount validator.
 *
 * Prevents client tampering: recomputes the expected final amount from
 * DB plan price minus the maximum allowed discount (cross-product + upgrade
 * proration credit). If the submitted amount is less than expected (with a
 * small rounding tolerance), the request is rejected.
 *
 * Used by: create-acpay-order, create-ecpay-order, create-linepay-order,
 *          create-checkup-ecpay-order.
 */

import { calcCrossDiscount, calcUpgradeProration } from "./revenueSplit.ts";

export interface ValidateExpertOrderInput {
  supabase: any;
  userId: string | null | undefined;
  planId: string;
  billingCycle: "monthly" | "yearly";
  clientAmount: number;
  upgradeFromSubscriptionId?: string | null;
}

export interface ValidateCheckupOrderInput {
  supabase: any;
  userId: string | null | undefined;
  checkupPlanId: string;
  billingCycle: "monthly" | "yearly";
  clientAmount: number;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  expected?: number;
  basePrice?: number;
  maxDiscount?: number;
  expertId?: string | null;
}

const TOLERANCE = 1; // ±1 TWD rounding tolerance

const DEFAULT_CROSS_RULES = {
  has_checkup_basic_discount_on_expert: 100,
  has_checkup_pro_discount_on_expert: 200,
  has_expert_discount_on_checkup_basic: 100,
  has_expert_discount_on_checkup_pro: 200,
};

async function loadCrossDiscountRules(supabase: any): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("payment_settings")
    .select("value")
    .eq("key", "cross_discounts")
    .maybeSingle();
  return (data?.value as Record<string, number>) || DEFAULT_CROSS_RULES;
}

async function loadUserActiveTiers(supabase: any, userId: string): Promise<{
  hasActiveExpert: boolean;
  activeCheckupTier: "basic" | "pro" | null;
}> {
  const nowIso = new Date().toISOString();
  const [{ data: expertSubs }, { data: ckSubs }] = await Promise.all([
    supabase
      .from("member_subscriptions")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("checkup_subscriptions")
      .select("id, expires_at, plan_id, checkup_plans(tier)")
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);

  const hasActiveExpert = (expertSubs || []).some(
    (s: any) => !s.expires_at || s.expires_at > nowIso,
  );

  let activeCheckupTier: "basic" | "pro" | null = null;
  const liveCk = (ckSubs || []).filter((s: any) => !s.expires_at || s.expires_at > nowIso);
  const tiers = liveCk.map((r: any) => r.checkup_plans?.tier).filter(Boolean);
  if (tiers.includes("pro")) activeCheckupTier = "pro";
  else if (tiers.includes("basic")) activeCheckupTier = "basic";

  return { hasActiveExpert, activeCheckupTier };
}

async function computeUpgradeCredit(
  supabase: any,
  userId: string,
  planId: string,
  upgradeFromSubscriptionId: string,
  plan: { price_monthly: number; price_yearly: number },
): Promise<number> {
  const { data: existing } = await supabase
    .from("member_subscriptions")
    .select("id, user_id, plan_id, started_at, expires_at, status")
    .eq("id", upgradeFromSubscriptionId)
    .maybeSingle();
  if (!existing) return 0;
  if (existing.user_id !== userId) return 0;
  if (existing.plan_id !== planId) return 0;
  if (existing.status !== "active") return 0;
  if (!existing.started_at || !existing.expires_at) return 0;
  const startedAt = new Date(existing.started_at);
  const expiresAt = new Date(existing.expires_at);
  const spanDays = (expiresAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
  // Monthly subs only (span ≤ ~35 days)
  if (spanDays > 35) return 0;
  const { creditAmount } = calcUpgradeProration({
    monthlyPrice: plan.price_monthly,
    yearlyPrice: plan.price_yearly,
    startedAt,
    expiresAt,
  });
  return Math.max(0, creditAmount);
}

export async function validateExpertOrderAmount(
  input: ValidateExpertOrderInput,
): Promise<ValidationResult> {
  const { supabase, userId, planId, billingCycle, clientAmount, upgradeFromSubscriptionId } = input;

  if (billingCycle !== "monthly" && billingCycle !== "yearly") {
    return { ok: false, reason: "billingCycle 必須為 monthly 或 yearly" };
  }
  if (!Number.isFinite(clientAmount) || clientAmount < 0) {
    return { ok: false, reason: "amount 不合法" };
  }

  const { data: plan } = await supabase
    .from("expert_plans")
    .select("id, expert_id, price_monthly, price_yearly, is_active, review_status")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active || plan.review_status !== "approved") {
    return { ok: false, reason: "方案不存在或未上架" };
  }

  const basePrice = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  if (!basePrice || basePrice <= 0) {
    return { ok: false, reason: "方案價格無效" };
  }

  let crossDiscount = 0;
  let upgradeCredit = 0;
  if (userId) {
    const [tiers, rules] = await Promise.all([
      loadUserActiveTiers(supabase, userId),
      loadCrossDiscountRules(supabase),
    ]);
    const cd = calcCrossDiscount({
      productKind: "expert_plan",
      hasActiveExpert: tiers.hasActiveExpert,
      activeCheckupTier: tiers.activeCheckupTier,
      rules,
    });
    crossDiscount = cd.amount;

    if (upgradeFromSubscriptionId && billingCycle === "yearly") {
      upgradeCredit = await computeUpgradeCredit(
        supabase,
        userId,
        planId,
        upgradeFromSubscriptionId,
        { price_monthly: plan.price_monthly, price_yearly: plan.price_yearly },
      );
    }
  }

  const maxDiscount = Math.min(basePrice, crossDiscount + upgradeCredit);
  const expected = Math.max(0, basePrice - maxDiscount);

  if (clientAmount + TOLERANCE < expected) {
    return {
      ok: false,
      reason: `金額不符 (expected≈${expected}, got=${clientAmount})`,
      expected,
      basePrice,
      maxDiscount,
      expertId: plan.expert_id,
    };
  }

  return { ok: true, expected, basePrice, maxDiscount, expertId: plan.expert_id };
}

export async function validateCheckupOrderAmount(
  input: ValidateCheckupOrderInput,
): Promise<ValidationResult> {
  const { supabase, userId, checkupPlanId, billingCycle, clientAmount } = input;

  if (billingCycle !== "monthly" && billingCycle !== "yearly") {
    return { ok: false, reason: "billingCycle 必須為 monthly 或 yearly" };
  }
  if (!Number.isFinite(clientAmount) || clientAmount < 0) {
    return { ok: false, reason: "amount 不合法" };
  }

  const { data: plan } = await supabase
    .from("checkup_plans")
    .select("id, tier, price_monthly, price_yearly, is_active")
    .eq("id", checkupPlanId)
    .maybeSingle();

  if (!plan || !plan.is_active) return { ok: false, reason: "方案不存在或已停用" };

  const basePrice = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  if (!basePrice || basePrice <= 0) return { ok: false, reason: "方案價格無效" };

  let crossDiscount = 0;
  if (userId) {
    const [tiers, rules] = await Promise.all([
      loadUserActiveTiers(supabase, userId),
      loadCrossDiscountRules(supabase),
    ]);
    const cd = calcCrossDiscount({
      productKind: "checkup",
      checkupTier: (plan.tier as any) || null,
      hasActiveExpert: tiers.hasActiveExpert,
      activeCheckupTier: tiers.activeCheckupTier,
      rules,
    });
    crossDiscount = cd.amount;
  }

  const maxDiscount = Math.min(basePrice, crossDiscount);
  const expected = Math.max(0, basePrice - maxDiscount);

  if (clientAmount + TOLERANCE < expected) {
    return {
      ok: false,
      reason: `金額不符 (expected≈${expected}, got=${clientAmount})`,
      expected,
      basePrice,
      maxDiscount,
    };
  }

  return { ok: true, expected, basePrice, maxDiscount };
}
