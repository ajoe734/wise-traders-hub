// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// e2e-simulate-purchase — test-only endpoint used by Route B live smoke.
//
// 目的：讓 daily cron 可以在真實後端跑完整 purchase 漏斗（member_subscriptions
// insert + payment_transactions insert + checkout_success traffic_event），
// 然後驗證後台 /company/funnel + /company/ops-health 儀表板數字 > 0。
//
// 安全鎖（缺一律 403）：
//   1. Env `E2E_ALLOW_SIMULATED_PURCHASE=1`（正式生產環境不設）
//   2. 呼叫者 JWT 必須解得出 user_id
//   3. profiles.is_tester = true
//
// 支援兩個 action：
//   - purchase：建立一筆 test subscription + payment_transaction + checkout_success 事件
//   - cleanup：把該 tester 帳號今天以來由本 fn 建立的所有測試資料清掉
//
// 由 e2e/live/subscription-end-to-end.spec.ts 呼叫，cleanup 由 afterAll 觸發。

import { corsPreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { serviceClient, getCallerUserId } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createSubscriptionAndTransaction } from '../_shared/paymentProcessor.ts';

const TX_PREFIX = 'E2E_SIMULATED_';

Deno.serve(withLogging('e2e-simulate-purchase', async (req, log) => {
  if (req.method === 'OPTIONS') return corsPreflight(req);
  if (req.method !== 'POST') return errorResponse('method_not_allowed', 405, undefined, req);

  if (Deno.env.get('E2E_ALLOW_SIMULATED_PURCHASE') !== '1') {
    return errorResponse('e2e_simulation_disabled', 403, undefined, req);
  }

  const userId = await getCallerUserId(req);
  if (!userId) return errorResponse('auth_required', 401, undefined, req);

  const supabase = serviceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_tester')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile?.is_tester) {
    return errorResponse('tester_only', 403, undefined, req);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action || 'purchase');

  try {
    if (action === 'cleanup') {
      return await handleCleanup(supabase, userId, req, log);
    }
    if (action === 'purchase') {
      return await handlePurchase(supabase, userId, body, req, log);
    }
    return errorResponse('unknown_action', 400, { action }, req);
  } catch (e) {
    return errorResponse((e as Error).message ?? 'unknown_error', 500, undefined, req);
  }
}));

async function handlePurchase(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  body: Record<string, unknown>,
  req: Request,
  log: { info: (msg: string, extra?: unknown) => void },
) {
  // 找一個可用 plan：優先用 body.planId → 環境變數 E2E_TEST_PLAN_ID → 第一個 active plan
  let planId = (body.planId as string | undefined)
    ?? Deno.env.get('E2E_TEST_PLAN_ID')
    ?? null;
  if (!planId) {
    const { data: firstPlan } = await supabase
      .from('expert_plans')
      .select('id')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true })
      .limit(1)
      .maybeSingle();
    planId = firstPlan?.id ?? null;
  }
  if (!planId) return errorResponse('no_plan_available', 400, undefined, req);

  const { data: plan } = await supabase
    .from('expert_plans')
    .select('id, expert_id, price_monthly, plan_type')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return errorResponse('plan_not_found', 404, { planId }, req);

  const providerTxId = `${TX_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const amount = plan.price_monthly ?? 1;

  const result = await createSubscriptionAndTransaction(supabase, {
    userId,
    planId: plan.id,
    billingCycle: 'monthly',
    amount,
    currency: 'TWD',
    providerTxId,
    providerId: null,
    productKind: 'expert_plan',
    expertId: plan.expert_id ?? null,
    originalAmount: amount,
    discountAmount: 0,
    discountReason: 'e2e_simulated_purchase',
    attribution: null,
  });
  if (result.error) return errorResponse(result.error, 500, undefined, req);

  // Funnel 事件：checkout_success（後台 /company/funnel 讀 traffic_events.event_name）
  const visitorId = (body.visitor_id as string | undefined) ?? `e2e-${userId.slice(0, 8)}`;
  await supabase.from('traffic_events').insert({
    visitor_id: visitorId,
    user_id: userId,
    route: '/checkout',
    event_name: 'checkout_success',
    event_props: {
      plan_id: plan.id,
      amount,
      simulated: true,
      provider_tx_id: providerTxId,
    },
    is_internal: false,
  });

  log.info('e2e_purchase_simulated', {
    subscriptionId: result.subscriptionId,
    transactionId: result.transactionId,
    providerTxId,
  });

  return jsonResponse(
    {
      ok: true,
      subscriptionId: result.subscriptionId,
      transactionId: result.transactionId,
      providerTxId,
      planId: plan.id,
      amount,
    },
    {},
    req,
  );
}

async function handleCleanup(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  req: Request,
  log: { info: (msg: string, extra?: unknown) => void },
) {
  // 1) 找出這個 tester 由 simulate 建立的 transactions
  const { data: txs } = await supabase
    .from('payment_transactions')
    .select('id, subscription_id, provider_tx_id')
    .like('provider_tx_id', `${TX_PREFIX}%`);
  const subIds = Array.from(
    new Set(
      (txs ?? [])
        .map((t) => t.subscription_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  );
  const txIds = (txs ?? []).map((t) => t.id);

  // 2) 只清屬於本 tester 的 subscription（雙保險）
  const { data: mySubs } = await supabase
    .from('member_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .in('id', subIds.length ? subIds : ['00000000-0000-0000-0000-000000000000']);
  const mySubIds = (mySubs ?? []).map((s) => s.id);

  // 3) 清 revenue_splits / payment_transactions / member_subscriptions
  if (txIds.length) {
    await supabase.from('revenue_splits').delete().in('transaction_id', txIds);
    await supabase.from('payment_transactions').delete().in('id', txIds);
  }
  if (mySubIds.length) {
    await supabase.from('member_subscriptions').delete().in('id', mySubIds);
  }

  // 4) 清 tester 產生的 simulated funnel 事件
  const { count: deletedEvents } = await supabase
    .from('traffic_events')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('event_name', 'checkout_success')
    .contains('event_props', { simulated: true });

  log.info('e2e_cleanup', {
    transactions: txIds.length,
    subscriptions: mySubIds.length,
    events: deletedEvents ?? 0,
  });

  return jsonResponse(
    {
      ok: true,
      deleted: {
        transactions: txIds.length,
        subscriptions: mySubIds.length,
        events: deletedEvents ?? 0,
      },
    },
    {},
    req,
  );
}
