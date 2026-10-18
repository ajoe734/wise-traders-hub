import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ handler: null as any, tables: {} as Record<string, any>, calls: {} as Record<string, any[]>, renewal: false, pending: true, txFails: false }));
vi.mock('../supabase/functions/_shared/supabaseClients.ts', () => ({ serviceClient: () => ({
  from: (table: string) => {
    let operation = 'select';
    const q: any = { select: () => q, eq: () => q, insert: (row: any) => { operation = 'insert'; (state.calls[table] ??= []).push(row); return q; }, update: () => q,
      single: async () => result(), maybeSingle: async () => result(), then: (resolve: any) => Promise.resolve(result()).then(resolve) };
    const result = () => ({ data: table === 'member_subscriptions' ? (operation === 'insert' ? { id: 'new-sub' } : state.renewal ? [{ id: 'old-sub' }] : null) : table === 'payment_transactions' ? state.txFails ? null : { id: 'tx' } : table === 'remittance_orders' ? { id: 'order', user_id: 'member', plan_id: 'plan', amount: 799, billing_cycle: 'monthly', product_kind: 'expert_plan', status: state.pending ? 'pending' : 'confirmed', attribution: snapshot } : state.tables[table] ?? null, error: table === 'payment_transactions' && state.txFails ? { message: 'failed' } : null });
    return q;
  }, rpc: async () => ({ data: 'social' }),
}) }));
vi.mock('../supabase/functions/_shared/adminGuard.ts', () => ({ requireCompanyAdmin: async () => 'admin', authErrorResponse: () => new Response('', { status: 403 }) }));
vi.mock('../supabase/functions/_shared/edgeLogger.ts', () => ({ withLogging: (_: string, fn: any) => (req: Request) => fn(req, { info: () => {}, error: () => {} }) }));
vi.mock('../supabase/functions/_shared/paymentVerify.ts', () => ({ acpayGenerateSign: async () => 'valid', acpayParseXml: (raw: string) => JSON.parse(raw), acpayExtractTxId: () => 'tx', isDuplicatePaymentTx: async () => false }));
vi.mock('../supabase/functions/_shared/paymentProcessor.ts', async () => {
  const { recordConversion } = await import('../supabase/functions/_shared/recordConversion');
  const save = async (db: any, p: any) => { await recordConversion(db, { userId: 'member', orderKind: 'expert_sub', orderId: 'order', grossAmount: 799, attribution: p.attribution }); return { error: null }; };
  return { writeRevenueSplit: async () => {}, renewExistingSubscription: async () => ({ error: null }), recordPaymentForExistingSubscription: save, createSubscriptionAndTransaction: save };
});
const snapshot = { utm_campaign: 'brcto_journal', utm_content: 'ig', visitor_id: 'visitor' };
beforeEach(() => {
  state.calls = {}; state.renewal = false; state.pending = true; state.txFails = false;
  state.tables = { payment_intents: { attribution: snapshot }, payment_providers: { id: 'provider' }, expert_plans: { expert_id: 'expert' } };
  vi.stubGlobal('Deno', { env: { get: () => 'mock-value' }, serve: (fn: any) => { state.handler = fn; } });
  vi.resetModules();
});
describe('payment handlers retain order source', () => {
  it.each([false, true])('ACpay signed callback new/renewal=%s uses stored source', async renewal => {
    state.renewal = renewal; await import('../supabase/functions/acpay-notify/index');
    const res = await state.handler(new Request('http://localhost/test', { method: 'POST', body: JSON.stringify({ sign: 'valid', pay_result: '0', out_trade_no: 'order', total_fee: '799', attach: JSON.stringify({ user_id: 'member', plan_id: 'plan', billing_cycle: 'monthly' }) }) }));
    expect(await res.text()).toBe('SUCCESS');
    expect(state.calls.conversions).toEqual([expect.objectContaining({ utm_campaign: 'brcto_journal', utm_content: 'ig', gross_amount: 799 })]);
  });
  it('rejected ACpay signature never writes a conversion', async () => {
    await import('../supabase/functions/acpay-notify/index');
    expect(await (await state.handler(new Request('http://localhost/test', { method: 'POST', body: '{}' }))).text()).toBe('FAIL');
    expect(state.calls.conversions).toBeUndefined();
  });
  it('remittance confirmation records successful paid order source', async () => {
    await import('../supabase/functions/confirm-remittance/index');
    const response = await state.handler(new Request('http://localhost/test', { method: 'POST', body: JSON.stringify({ orderId: 'order' }) }));
    expect(response.status).toBe(200);
    expect(state.calls.conversions).toEqual([expect.objectContaining({ utm_campaign: 'brcto_journal', utm_content: 'ig', order_id: 'order', gross_amount: 799 })]);
  });
  it.each(['already-confirmed', 'transaction-failure'])('%s remittance does not create a conversion', async mode => {
    state.pending = mode !== 'already-confirmed'; state.txFails = mode === 'transaction-failure';
    await import('../supabase/functions/confirm-remittance/index');
    await state.handler(new Request('http://localhost/test', { method: 'POST', body: JSON.stringify({ orderId: 'order' }) }));
    expect(state.calls.conversions).toBeUndefined();
  });
});