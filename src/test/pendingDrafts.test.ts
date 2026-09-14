import { describe, it, expect } from 'vitest';
import { computePendingDrafts } from '@/pages/_adminSignals/pendingDrafts';

const base = {
  id: 'x', batch_id: 'b1', status: 'pending', action: 'buy',
  instrument: '2330 台積電', teaching_topic: null, overall_summary: null,
  published_at: '2026-09-10T02:00:00Z', created_at: '2026-09-10T02:00:00Z',
};

describe('computePendingDrafts', () => {
  it('同一批次合併成一篇週記', () => {
    const drafts = computePendingDrafts([
      { ...base, id: '1', teaching_topic: '本週操作心法' },
      { ...base, id: '2', instrument: '2454 聯發科' },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].batchId).toBe('b1');
    expect(drafts[0].title).toBe('本週操作心法');
    expect(drafts[0].tradeCount).toBe(2);
  });

  it('已發布週記不會出現在待發布清單', () => {
    expect(computePendingDrafts([{ ...base, status: 'published' }])).toHaveLength(0);
  });

  it('純教學週記標示為教學且交易數 0', () => {
    const drafts = computePendingDrafts([
      { ...base, action: 'teaching', instrument: '', overall_summary: '<p>觀察紀錄</p>' },
    ]);
    expect(drafts[0].isTeachingOnly).toBe(true);
    expect(drafts[0].tradeCount).toBe(0);
    expect(drafts[0].title).toContain('觀察紀錄');
  });

  it('沒有批次代號的舊資料不提供編輯入口', () => {
    expect(computePendingDrafts([{ ...base, batch_id: null }])).toHaveLength(0);
  });

  it('多篇依最後儲存時間新到舊排序', () => {
    const drafts = computePendingDrafts([
      { ...base, id: '1', batch_id: 'old', published_at: '2026-09-01T00:00:00Z' },
      { ...base, id: '2', batch_id: 'new', published_at: '2026-09-12T00:00:00Z' },
    ]);
    expect(drafts.map((d) => d.batchId)).toEqual(['new', 'old']);
  });
});
