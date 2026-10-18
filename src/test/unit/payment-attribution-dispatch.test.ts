import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
import { dispatchAcpay, dispatchEcpay, dispatchLinePay, dispatchRemittance, type DispatchCtx } from '@/pages/_checkout/paymentDispatchers';
const ctx = { plan: { id: 'plan', expert_id: 'expert', name: '週記' }, expert: { name: 'brcto' }, slug: 'master-brcto', userId: 'member', billingCycle: 'monthly', basePrice: 799, price: 799, totalDiscount: 0, discountReason: undefined, upgradeFromSubscriptionId: null, origin: 'http://localhost:8080' } as DispatchCtx;
describe('all expert checkout providers preserve attribution', () => {
  beforeEach(() => { invoke.mockReset(); localStorage.clear(); });
  for (const content of [undefined, 'ig', 'fb', 'yt', 'line']) {
    const snapshot = { utm_campaign: 'brcto_journal', utm_content: content, visitor_id: 'v', locked_until: Date.now() + 86400000 };
    const cases = [
      ['create-linepay-order', () => dispatchLinePay(ctx), { paymentUrl: '/mock' }],
      ['create-ecpay-order', () => dispatchEcpay(ctx), { actionUrl: '/mock', params: {} }],
      ['create-acpay-order', () => dispatchAcpay(ctx, { prime: 'test', phone: '0912345678', countryCode: '886', cardHolderName: 'TEST', cardHolderEmail: 'test@example.test' }), { success: true }],
      ['create-expert-remittance', () => dispatchRemittance(ctx, 'request'), { orderId: 'order' }],
    ] as const;
    it.each(cases)(`${content ?? 'unmarked'} %s sends exact first-touch payload`, async (name, run, response) => {
      localStorage.setItem('lf_attr_v1', JSON.stringify(snapshot)); invoke.mockResolvedValue({ data: response });
      await run();
      expect(invoke).toHaveBeenCalledWith(name, expect.objectContaining({ body: expect.objectContaining({ attribution: JSON.parse(JSON.stringify(snapshot)) }) }));
    });
  }
});