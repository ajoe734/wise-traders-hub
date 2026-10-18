import { describe, expect, it, vi } from 'vitest';
import { recordConversion } from '../../../supabase/functions/_shared/recordConversion';
describe('conversion attribution evidence', () => {
  function client(tv: any = null, ra: any = null) {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: table === 'traffic_visits' ? tv : ra }), insert };
      return q;
    }, rpc: vi.fn().mockResolvedValue({ data: 'social' }) };
    return { db, insert };
  }
  it.each(['ig', 'fb', 'yt', 'line', undefined])('uses the order snapshot for platform %s rather than unrelated oldest visit', async content => {
    const { db, insert } = client({ utm_campaign: 'unrelated', utm_content: 'fb' });
    await recordConversion(db, { userId: 'member', orderKind: 'expert_sub', orderId: 'order', grossAmount: 799, attribution: { utm_campaign: 'brcto_journal', utm_content: content, visitor_id: 'v' } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ utm_campaign: 'brcto_journal', utm_content: content ?? null, visitor_id: 'v', order_id: 'order', gross_amount: 799 }));
  });
  it('falls back to authenticated referral when no visit or order snapshot exists', async () => {
    const { db, insert } = client(null, { utm_campaign: 'brcto_journal', utm_content: 'yt', visitor_id: 'v' });
    await recordConversion(db, { userId: 'member', orderKind: 'checkup_sub', grossAmount: 799 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ utm_campaign: 'brcto_journal', utm_content: 'yt' }));
  });
  it('retains legacy traffic visit fallback', async () => {
    const { db, insert } = client({ utm_campaign: 'legacy', utm_content: 'line' });
    await recordConversion(db, { userId: 'member', orderKind: 'expert_sub', grossAmount: 799 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ utm_campaign: 'legacy', utm_content: 'line' }));
  });
});