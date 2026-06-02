/**
 * H14 後續：holdings analytics 事件詞彙與 urgency vocab 對齊
 * - checkup_holdings_filter_change 的 urgency dimension 只接受 now/soon/monitor
 * - checkup_holdings_sort_change 不會出現舊詞彙 high/medium/low
 * - track() 寫入 trafficTracker 的 payload 與 events.ts 宣告一致
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/trafficTracker', () => ({
  trackEvent: vi.fn(),
}));

import { track } from '@/lib/analytics/events';
import { trackEvent } from '@/lib/trafficTracker';
import { URGENCY_RANK } from '@/checkup/lib/holdingsSort';

const URGENCY_KEYS = Object.keys(URGENCY_RANK).sort();

describe('H14 — holdings analytics urgency vocab', () => {
  beforeEach(() => {
    (trackEvent as unknown as { mockClear: () => void }).mockClear();
  });

  it('URGENCY_RANK 提供的 keys 與 filter event 接受的 urgency value 一致', () => {
    expect(URGENCY_KEYS).toEqual(['monitor', 'now', 'soon']);
  });

  it('checkup_holdings_filter_change 對每一個 urgency key 都能正確送出', () => {
    for (const key of URGENCY_KEYS) {
      track('checkup_holdings_filter_change', {
        dimension: 'urgency',
        value: key,
        action: 'add',
      });
    }
    expect(trackEvent).toHaveBeenCalledTimes(URGENCY_KEYS.length);
    const calls = (trackEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const values = calls.map((c) => (c[1] as { value: string }).value).sort();
    expect(values).toEqual(URGENCY_KEYS);
    // 禁止舊詞彙
    for (const c of calls) {
      const p = c[1] as { value: string };
      expect(['high', 'medium', 'low']).not.toContain(p.value);
    }
  });

  it('checkup_holdings_sort_change urgency_priority 排序 payload 不含舊詞彙', () => {
    track('checkup_holdings_sort_change', { sort_by: 'urgency', sort_dir: 'desc' });
    const calls = (trackEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const last = calls[calls.length - 1];
    const props = last[1] as Record<string, string>;
    expect(props.sort_by).toBe('urgency');
    expect(JSON.stringify(props)).not.toMatch(/\b(high|medium|low)\b/);
  });
});
