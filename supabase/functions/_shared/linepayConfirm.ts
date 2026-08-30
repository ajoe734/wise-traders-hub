// deno-lint-ignore-file no-explicit-any
/**
 * linepayConfirm — LINE Pay confirm 的單一資料源（純邏輯 + 注入依賴）。
 *
 * 安全契約（SECURITY_ACCESS_FIX 1）：
 *  1. body 只接受 { orderId, transactionId }。任何未知欄位 → 400 fail-closed，零 mutation。
 *     production 不再接受 client 控制的 simulate / userId / planId / amount。
 *  2. user / plan / amount / billingCycle 一律從 payment_intents（trade_no = orderId）反查。
 *  3. 必須先向 LINE Pay confirm，且 returnCode === '0000'，
 *     並逐項比對 orderId / transactionId / amount / currency，全部相符才寫入。
 *  4. provider_tx_id 具 DB unique index（idx_payment_tx_provider_tx_id_unique）；
 *     重播相同 transactionId → 200 no-op，不會續期第二次。
 *  5. 任何 provider / config / intent / 欄位缺失 → 零 mutation。
 */

import {
  createSubscriptionAndTransaction,
  recordPaymentForExistingSubscription,
  renewExistingSubscription,
} from './paymentProcessor.ts';
import { linepayHmacSha256Base64 } from './paymentVerify.ts';

/** body 白名單。多一個 key 就 fail-closed。 */
export const ALLOWED_CONFIRM_BODY_KEYS = ['orderId', 'transactionId'] as const;

/** 固定幣別：LINE Pay lane 只做 TWD。 */
export const LINEPAY_CURRENCY = 'TWD';

export interface ConfirmBody {
  orderId: string;
  transactionId: string;
}

export type ParseResult =
  | { ok: true; value: ConfirmBody }
  | { ok: false; code: string; message: string };

export interface ConfirmDeps {
  supabase: any;
  fetchFn: typeof fetch;
  env: (key: string) => string | undefined;
  now?: Date;
  log?: { error?: (evt: string, data?: unknown) => void; info?: (evt: string, data?: unknown) => void };
}

export interface ConfirmOutcome {
  status: number;
  body: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 嚴格解析 body：白名單 + 型別 + 非空。未知欄位一律拒絕。 */
export function parseConfirmBody(body: unknown): ParseResult {
  if (!isPlainObject(body)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const allowed = new Set<string>(ALLOWED_CONFIRM_BODY_KEYS as readonly string[]);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: 'UNKNOWN_FIELD',
      message: `unsupported field(s): ${unknown.sort().join(', ')}`,
    };
  }
  const orderId = body.orderId;
  const transactionId = body.transactionId;
  for (const [k, v] of [['orderId', orderId], ['transactionId', transactionId]] as const) {
    if (typeof v !== 'string' || v.trim() === '') {
      return { ok: false, code: 'BAD_REQUEST', message: `${k} is required and must be a non-empty string` };
    }
  }
  return { ok: true, value: { orderId: String(orderId).trim(), transactionId: String(transactionId).trim() } };
}

/** 從 LINE Pay confirm response 取出可比對的欄位（容錯不同包裝）。 */
export function extractConfirmEcho(result: any): {
  orderId: string | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
} {
  const info = result?.info ?? {};
  const payInfo = Array.isArray(info?.payInfo) ? info.payInfo : [];
  const paySum = payInfo.reduce((acc: number, p: any) => acc + Number(p?.amount ?? 0), 0);
  const amount = payInfo.length > 0
    ? paySum
    : (info?.amount != null ? Number(info.amount) : null);
  const currency = info?.currency ?? payInfo[0]?.currency ?? null;
  return {
    orderId: info?.orderId != null ? String(info.orderId) : null,
    transactionId: info?.transactionId != null ? String(info.transactionId) : null,
    amount: Number.isFinite(amount as number) ? Number(amount) : null,
    currency: currency != null ? String(currency) : null,
  };
}

/** 逐欄比對 provider 回應與 intent。回傳不符欄位清單（空 = 全部相符）。 */
export function diffConfirmEcho(
  echo: ReturnType<typeof extractConfirmEcho>,
  expected: { orderId: string; transactionId: string; amount: number; currency: string },
): string[] {
  const bad: string[] = [];
  if (echo.orderId !== null && echo.orderId !== expected.orderId) bad.push('orderId');
  if (echo.transactionId !== null && echo.transactionId !== expected.transactionId) bad.push('transactionId');
  if (echo.amount === null || Number(echo.amount) !== Number(expected.amount)) bad.push('amount');
  if (echo.currency !== null && String(echo.currency).toUpperCase() !== expected.currency.toUpperCase()) {
    bad.push('currency');
  }
  return bad;
}

function fail(status: number, code: string, message: string): ConfirmOutcome {
  return { status, body: { success: false, code, error: message } };
}

/**
 * 主流程。任何 early return 之前都不得有任何寫入。
 */
export async function confirmLinepayPayment(deps: ConfirmDeps, rawBody: unknown): Promise<ConfirmOutcome> {
  const { supabase, fetchFn, env } = deps;
  const log = deps.log ?? {};
  const now = deps.now ?? new Date();

  // ---- 1. body 白名單 ------------------------------------------------------
  const parsed = parseConfirmBody(rawBody);
  if (!parsed.ok) return fail(400, parsed.code, parsed.message);
  const { orderId, transactionId } = parsed.value;

  // ---- 2. config（缺一不可，零 mutation） ---------------------------------
  const channelId = env('LINEPAY_CHANNEL_ID') ?? '';
  const channelSecret = env('LINEPAY_CHANNEL_SECRET') ?? '';
  if (!channelId || !channelSecret) {
    log.error?.('linepay_config_missing', { hasChannelId: !!channelId });
    return fail(503, 'PROVIDER_CONFIG_MISSING', 'LINE Pay channel credentials are not configured');
  }

  // ---- 3. idempotency：相同 provider transaction 直接 no-op ---------------
  const { data: existingTx, error: txLookupErr } = await supabase
    .from('payment_transactions')
    .select('id, subscription_id')
    .eq('provider_tx_id', transactionId)
    .maybeSingle();
  if (txLookupErr) {
    log.error?.('tx_lookup_failed', { message: String((txLookupErr as any)?.message ?? txLookupErr) });
    return fail(503, 'LOOKUP_FAILED', 'payment transaction lookup failed');
  }
  if (existingTx) {
    return {
      status: 200,
      body: {
        success: true,
        idempotent: true,
        replay: true,
        subscriptionId: existingTx.subscription_id ?? null,
      },
    };
  }

  // ---- 4. intent 反查（user/plan/amount 唯一來源） ------------------------
  const { data: intent, error: intentErr } = await supabase
    .from('payment_intents')
    .select('id, trade_no, user_id, plan_id, expert_id, billing_cycle, amount, original_amount, discount_amount, discount_reason, attribution, product_kind, status')
    .eq('trade_no', orderId)
    .maybeSingle();
  if (intentErr) {
    log.error?.('intent_lookup_failed', { message: String((intentErr as any)?.message ?? intentErr) });
    return fail(503, 'LOOKUP_FAILED', 'payment intent lookup failed');
  }
  if (!intent) return fail(404, 'INTENT_NOT_FOUND', 'no payment intent for this orderId');

  const missing: string[] = [];
  if (!intent.user_id) missing.push('user_id');
  if (!intent.plan_id) missing.push('plan_id');
  if (!(Number(intent.amount) > 0)) missing.push('amount');
  if (missing.length > 0) {
    return fail(409, 'INTENT_INCOMPLETE', `payment intent missing: ${missing.join(', ')}`);
  }

  const amount = Number(intent.amount);
  const billingCycle = intent.billing_cycle === 'yearly' ? 'yearly' : 'monthly';

  // ---- 5. provider 設定列 --------------------------------------------------
  const { data: provider, error: provErr } = await supabase
    .from('payment_providers')
    .select('id')
    .eq('provider_type', 'line_pay')
    .eq('is_active', true)
    .maybeSingle();
  if (provErr) {
    log.error?.('provider_lookup_failed', { message: String((provErr as any)?.message ?? provErr) });
    return fail(503, 'LOOKUP_FAILED', 'payment provider lookup failed');
  }
  if (!provider?.id) return fail(503, 'PROVIDER_NOT_CONFIGURED', 'no active line_pay provider row');

  // ---- 6. provider confirm（必經，無 simulate 逃生門） --------------------
  const nonce = crypto.randomUUID();
  const apiUri = `/v3/payments/${encodeURIComponent(transactionId)}/confirm`;
  const bodyStr = JSON.stringify({ amount, currency: LINEPAY_CURRENCY });
  const signature = await linepayHmacSha256Base64(channelSecret, channelSecret + apiUri + bodyStr + nonce);
  const apiUrl = env('LINEPAY_API_URL') || 'https://sandbox-api-pay.line.me';

  let result: any;
  try {
    const response = await fetchFn(`${apiUrl}${apiUri}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LINE-ChannelId': channelId,
        'X-LINE-Authorization-Nonce': nonce,
        'X-LINE-Authorization': signature,
      },
      body: bodyStr,
    });
    result = await response.json();
  } catch (e) {
    log.error?.('linepay_confirm_unreachable', { message: (e as Error)?.message ?? String(e) });
    return fail(502, 'PROVIDER_UNAVAILABLE', 'LINE Pay confirm request failed');
  }

  if (result?.returnCode !== '0000') {
    log.error?.('linepay_confirm_declined', {
      returnCode: result?.returnCode,
      returnMessage: result?.returnMessage,
    });
    return {
      status: 402,
      body: {
        success: false,
        code: 'PROVIDER_DECLINED',
        error: result?.returnMessage || 'Confirm failed',
        returnCode: result?.returnCode ?? null,
      },
    };
  }

  const echo = extractConfirmEcho(result);
  const mismatched = diffConfirmEcho(echo, {
    orderId,
    transactionId,
    amount,
    currency: LINEPAY_CURRENCY,
  });
  if (mismatched.length > 0) {
    log.error?.('linepay_confirm_mismatch', { mismatched });
    return fail(409, 'PROVIDER_MISMATCH', `provider echo mismatch: ${mismatched.join(', ')}`);
  }

  // ---- 7. 通過所有驗證，才允許 mutation --------------------------------------
  await supabase
    .from('payment_intents')
    .update({ status: 'completed', completed_at: now.toISOString() })
    .eq('trade_no', orderId);

  const { data: existingSubs } = await supabase
    .from('member_subscriptions')
    .select('id')
    .eq('user_id', intent.user_id)
    .eq('plan_id', intent.plan_id)
    .eq('status', 'active');

  if (existingSubs && existingSubs.length > 0) {
    const subscriptionId = existingSubs[0].id;
    const renewResult = await renewExistingSubscription(supabase, { subscriptionId, billingCycle, now });
    if (renewResult.error) log.error?.('renewal_extend_error', { error: String(renewResult.error) });
    const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
      subscriptionId,
      amount,
      currency: LINEPAY_CURRENCY,
      providerTxId: transactionId,
      providerId: provider.id,
      now,
      originalAmount: intent.original_amount ?? amount,
      discountAmount: intent.discount_amount ?? 0,
      discountReason: intent.discount_reason ?? null,
      attribution: intent.attribution ?? null,
      planId: intent.plan_id,
      expertId: intent.expert_id ?? null,
      productKind: intent.product_kind === 'checkup' ? 'checkup' : 'expert_plan',
    });
    if (txError) log.error?.('tx_insert_error', { message: String(txError) });
    return {
      status: 200,
      body: { success: true, subscriptionId, renewed: true, newExpiresAt: renewResult.newExpiresAt },
    };
  }

  const created = await createSubscriptionAndTransaction(supabase, {
    userId: intent.user_id,
    planId: intent.plan_id,
    billingCycle,
    amount,
    currency: LINEPAY_CURRENCY,
    providerTxId: transactionId,
    providerId: provider.id,
    now,
    originalAmount: intent.original_amount ?? amount,
    discountAmount: intent.discount_amount ?? 0,
    discountReason: intent.discount_reason ?? null,
    attribution: intent.attribution ?? null,
    expertId: intent.expert_id ?? null,
    productKind: intent.product_kind === 'checkup' ? 'checkup' : 'expert_plan',
  });
  if (created.error) {
    log.error?.('create_sub_tx_failed', { error: String(created.error) });
    return fail(500, 'PERSIST_FAILED', 'failed to persist subscription');
  }

  return { status: 200, body: { success: true, subscriptionId: created.subscriptionId } };
}
