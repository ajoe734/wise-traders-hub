import { supabase } from '@/integrations/supabase/client';
import { readAttribution } from '@/hooks/useAttributionTracking';
import type { DbPlan, DbExpert } from '@/hooks/checkout/useCheckoutData';

export type DispatchResult =
  | { kind: 'success' }
  | { kind: 'failure'; message: string; canRetry?: boolean }
  | { kind: 'redirect'; url: string }
  | { kind: 'ecpay_form'; actionUrl: string; params: Record<string, unknown> }
  | { kind: 'remittance'; orderId: string; message: string };

export interface DispatchCtx {
  plan: DbPlan;
  expert: DbExpert;
  slug: string | undefined;
  userId: string;
  billingCycle: 'monthly' | 'yearly';
  basePrice: number;
  price: number;
  totalDiscount: number;
  discountReason: string | undefined;
  upgradeFromSubscriptionId: string | null;
  origin: string;
}

export async function dispatchLinePay(ctx: DispatchCtx): Promise<DispatchResult> {
  const { data, error } = await supabase.functions.invoke('create-linepay-order', {
    body: {
      planId: ctx.plan.id,
      billingCycle: ctx.billingCycle,
      slug: ctx.slug,
      amount: ctx.price,
      originalAmount: ctx.basePrice,
      discountAmount: ctx.totalDiscount,
      discountReason: ctx.discountReason,
      attribution: readAttribution(),
      expertId: ctx.plan.expert_id,
      upgradeFromSubscriptionId: ctx.upgradeFromSubscriptionId,
      userId: ctx.userId,
      planName: ctx.plan.name,
      expertName: ctx.expert.name,
      origin: ctx.origin,
    },
  });
  if (error || !data?.paymentUrl) {
    console.error('Create LINE Pay order error:', error || data);
    return { kind: 'failure', message: '建立 LINE Pay 訂單失敗，請稍後再試' };
  }
  return { kind: 'redirect', url: data.paymentUrl };
}

export async function dispatchEcpay(ctx: DispatchCtx): Promise<DispatchResult> {
  const { data, error } = await supabase.functions.invoke('create-ecpay-order', {
    body: {
      planId: ctx.plan.id,
      billingCycle: ctx.billingCycle,
      slug: ctx.slug,
      amount: ctx.price,
      originalAmount: ctx.basePrice,
      discountAmount: ctx.totalDiscount,
      discountReason: ctx.discountReason,
      attribution: readAttribution(),
      expertId: ctx.plan.expert_id,
      upgradeFromSubscriptionId: ctx.upgradeFromSubscriptionId,
      planName: ctx.plan.name,
      expertName: ctx.expert.name,
      origin: ctx.origin,
      userId: ctx.userId,
    },
  });
  if (error || !data?.actionUrl || !data?.params) {
    console.error('Create ECPay order error:', error || data);
    return { kind: 'failure', message: '建立綠界訂單失敗，請稍後再試' };
  }
  return { kind: 'ecpay_form', actionUrl: data.actionUrl, params: data.params };
}

export interface AcpayInput {
  prime: string;
  phone: string;
  countryCode: string;
  cardHolderName: string;
  cardHolderEmail: string;
}

export async function dispatchAcpay(ctx: DispatchCtx, input: AcpayInput): Promise<DispatchResult> {
  const { data, error } = await supabase.functions.invoke('create-acpay-order', {
    body: {
      prime: input.prime,
      amount: ctx.price,
      phone: input.phone,
      countryCode: input.countryCode,
      cardHolderName: input.cardHolderName,
      cardHolderEmail: input.cardHolderEmail,
      planId: ctx.plan.id,
      billingCycle: ctx.billingCycle,
      userId: ctx.userId,
      origin: ctx.origin,
      slug: ctx.slug,
      planName: ctx.plan.name,
      expertName: ctx.expert.name,
      originalAmount: ctx.basePrice,
      discountAmount: ctx.totalDiscount,
      discountReason: ctx.discountReason,
      attribution: readAttribution(),
      expertId: ctx.plan.expert_id,
      upgradeFromSubscriptionId: ctx.upgradeFromSubscriptionId,
    },
  });
  if (error) {
    console.error('ACpay checkout error:', error);
    return { kind: 'failure', message: '建立 ACpay 訂單失敗，請稍後再試' };
  }
  if (data?.threeDS && data?.codeUrl) return { kind: 'redirect', url: data.codeUrl };
  if (data?.success) return { kind: 'success' };
  return { kind: 'failure', message: '付款失敗，請稍後再試' };
}

export async function dispatchRemittance(
  ctx: DispatchCtx,
  clientRequestId: string,
): Promise<DispatchResult> {
  const { data, error } = await supabase.functions.invoke('create-expert-remittance', {
    body: {
      planId: ctx.plan.id,
      billingCycle: ctx.billingCycle,
      originalAmount: ctx.basePrice,
      discountAmount: ctx.totalDiscount,
      discountReason: ctx.discountReason,
      attribution: readAttribution(),
      upgradeFromSubscriptionId: ctx.upgradeFromSubscriptionId,
      clientRequestId,
    },
  });
  if (error || !data?.orderId) {
    console.error('Create remittance order error:', error || data);
    return { kind: 'failure', message: '建立匯款訂單失敗，請稍後再試', canRetry: true };
  }
  return {
    kind: 'remittance',
    orderId: data.orderId,
    message: '已建立匯款訂單。請於 3 日內完成銀行轉帳，並回到「會員中心 → 我的匯款訂單」補填末五碼與匯款人姓名。您可以隨時離開本頁稍後再回來。',
  };
}

/** Build and POST a hidden form (ECPay action_url + params). */
export function submitEcpayForm(actionUrl: string, params: Record<string, unknown>) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  form.style.display = 'none';
  for (const [key, value] of Object.entries(params)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export function validateAcpayCardholder(input: {
  cardHolderName: string;
  cardHolderEmail: string;
  cardHolderPhone: string;
}): { ok: true } | { ok: false; errors: { name?: string; email?: string; phone?: string } } {
  const errors: { name?: string; email?: string; phone?: string } = {};
  if (!input.cardHolderName.trim()) errors.name = '請輸入英文姓名';
  else if (!/^[a-zA-Z\s]+$/.test(input.cardHolderName.trim())) errors.name = '姓名須為英文字母';
  if (!input.cardHolderEmail.trim()) errors.email = '請輸入電子郵件';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.cardHolderEmail.trim())) errors.email = '電子郵件格式不正確';
  if (!input.cardHolderPhone.trim()) errors.phone = '請輸入手機號碼';
  else if (!/^\d{9,10}$/.test(input.cardHolderPhone.trim())) errors.phone = '手機號碼須為 9-10 位數字';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true };
}
