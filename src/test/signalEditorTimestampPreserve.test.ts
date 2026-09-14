import { describe, it, expect } from 'vitest';
import { buildPublishRows, buildTeachingOnlyRow } from '@/pages/_signalEditor/derive';
import { emptyTrade } from '@/pages/_signalEditor/types';

const trade = () => ({
  ...emptyTrade('tw_stock'),
  stockCode: '2330',
  stockName: '台積電',
  action: 'buy',
  quantity: '1',
  priceHint: '600',
  executedAt: '2026-09-10T10:00',
});

describe('重存週記沿用原本時間', () => {
  it('buildPublishRows 帶入 publishedAt/createdAt 時寫回原值', () => {
    const rows = buildPublishRows({
      expertId: 'e1', batchId: 'b1', status: 'pending', assetClass: 'tw_stock', isMentor: true,
      teachingTopic: '', overallSummary: '', learningPoints: '', trades: [trade() as any],
      publishedAt: '2026-09-08T01:00:00Z', createdAt: '2026-09-08T00:00:00Z',
    });
    expect(rows[0].published_at).toBe('2026-09-08T01:00:00Z');
    expect(rows[0].created_at).toBe('2026-09-08T00:00:00Z');
  });

  it('新增時不帶時間欄位，交給資料庫填現在時間', () => {
    const rows = buildPublishRows({
      expertId: 'e1', batchId: 'b1', status: 'pending', assetClass: 'tw_stock', isMentor: true,
      teachingTopic: '', overallSummary: '', learningPoints: '', trades: [trade() as any],
    });
    expect('published_at' in rows[0]).toBe(false);
    expect('created_at' in rows[0]).toBe(false);
  });

  it('純教學週記同樣沿用原時間', () => {
    const rows = buildTeachingOnlyRow({
      expertId: 'e1', batchId: 'b1', status: 'pending',
      teachingTopic: '心法', overallSummary: '', learningPoints: '',
      publishedAt: '2026-09-08T01:00:00Z', createdAt: '2026-09-08T00:00:00Z',
    });
    expect(rows[0].published_at).toBe('2026-09-08T01:00:00Z');
    expect(rows[0].executed_at).toBe('2026-09-08T01:00:00Z');
  });
});
