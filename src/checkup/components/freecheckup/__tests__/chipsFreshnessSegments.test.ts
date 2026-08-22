import { describe, it, expect } from 'vitest';
import {
  buildFreshnessSegments,
  buildBsrSegment,
  buildInstitutionalSegment,
} from '../chipsFreshnessSegments';

const base: any = {
  stock_id: '2330',
  as_of: '2026-08-17',
  as_of_lag_days: 0,
  bsr_as_of: '2026-08-14',
  bsr_lag_weekdays: 3,
};

describe('chipsFreshnessSegments', () => {
  it('回傳兩段且順序固定：法人 → 分點', () => {
    const segs = buildFreshnessSegments(base);
    expect(segs.map((s) => s.key)).toEqual(['institutional', 'bsr']);
  });

  it('法人：lag 0 為 fresh，lag>=2 為 lagging，無日期為 no_data', () => {
    expect(buildInstitutionalSegment(base).state).toBe('fresh');
    expect(buildInstitutionalSegment({ ...base, as_of_lag_days: 4 }).state).toBe('lagging');
    expect(buildInstitutionalSegment({ ...base, as_of: null }).state).toBe('no_data');
  });

  it('分點：sync_failed / no_data / not_queued 一律標成不可用', () => {
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'sync_failed' }).state).toBe('unavailable_failed');
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'no_data' }).state).toBe('unavailable');
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'not_queued' }).state).toBe('unavailable');
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'no_data' }).tone).toBe('error');
  });

  it('分點不可用時文案為 canonical 統一文案（不得洩漏 provider／方案／內部 code）', () => {
    const text = buildBsrSegment({ ...base, bsr_freshness_status: 'sync_failed' }).text;
    expect(text).toContain('籌碼資料暫時無法取得');
    for (const forbidden of ['目前不可用', '上游中止', '上游來源中止', 'FinMind', 'sponsor', 'HTTP']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('分點 fresh / lagging / syncing / ineligible 映射正確', () => {
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'fresh' }).text).toBe('2026/08/14');
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'lagging' }).text).toContain('落後 3 個交易日');
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'syncing' }).state).toBe('syncing');
    expect(buildBsrSegment({ ...base, bsr_freshness_status: 'ineligible' }).tone).toBe('muted');
  });

  it('法人與分點狀態互不影響（分點死掉不會被法人染成新鮮）', () => {
    const [inst, bsr] = buildFreshnessSegments({ ...base, bsr_freshness_status: 'sync_failed' } as any);
    expect(inst.state).toBe('fresh');
    expect(bsr.tone).toBe('error');
  });
});
