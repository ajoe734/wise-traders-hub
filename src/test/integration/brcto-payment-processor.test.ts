import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription } from '../../../supabase/functions/_shared/paymentProcessor';
import { createQueryMock } from '../mocks/supabase';
describe('shared actual payment processing → campaign conversion', () => {
  it.each([false, true])('new/renewal=%s writes exact platform and campaign after transaction', async renewal => {
    const conversion = createQueryMock({ data: null, error: null });
    const tables = {
      member_subscriptions: createQueryMock({ data: { id: 'sub', user_id: 'member' }, error: null }),
      payment_transactions: createQueryMock({ data: { id: 'tx' }, error: null }),
      payment_settings: createQueryMock({ data: [], error: null }),
      conversions: conversion,
    };
    const db = { from: (name: string) => tables[name as keyof typeof tables] ?? createQueryMock({ data: null, error: null }), rpc: vi.fn().mockResolvedValue({ data: 'social' }) };
    const params = { userId: 'member', planId: 'plan', subscriptionId: 'sub', billingCycle: 'monthly', amount: 799, currency: 'TWD', providerTxId: 'tx', providerId: null, attribution: { visitor_id: 'v', utm_campaign: 'brcto_journal', utm_content: 'line' } };
    if (renewal) await recordPaymentForExistingSubscription(db, params);
    else await createSubscriptionAndTransaction(db, params);
    expect(conversion.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'member', utm_campaign: 'brcto_journal', utm_content: 'line', gross_amount: 799 }));
  });
});