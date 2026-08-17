/**
 * Plan v2 · 前端五類狀態文案回歸。
 * 重點：terminal（永久拒絕）絕不可出現「同步中／自動重試／預計 hh:mm／暫時性」。
 */
import { describe, it, expect } from 'vitest';
import { buildBsrSegment } from '@/checkup/components/freecheckup/chipsFreshnessSegments';
import { bsrHeaderLabel } from '@/checkup/components/freecheckup/bsrHeaderLabel';

const FORBIDDEN = ['同步中', '自動重試', '暫時性', '額度'];

function payload(over: any) {
  return {
    stock_id: '2308',
    bsr_as_of: '2026-08-14',
    bsr_freshness_status: 'syncing',
    bsr_lag_weekdays: 1,
    ...over,
  } as any;
}

describe('buildBsrSegment × provider_state', () => {
  it('terminal + 有舊資料（2308 真實形狀）', () => {
    const seg = buildBsrSegment(payload({ bsr_provider_state: 'terminal_provider_rejected' }));
    expect(seg.state).toBe('terminal_stale');
    expect(seg.text).toBe('2026/08/14 · 上游來源中止，顯示前次成功資料');
    FORBIDDEN.forEach((w) => expect(seg.text).not.toContain(w));
  });

  it('terminal + 無任何資料', () => {
    const seg = buildBsrSegment(
      payload({ bsr_as_of: null, bsr_provider_state: 'terminal_provider_rejected' }),
    );
    expect(seg.state).toBe('terminal_no_data');
    expect(seg.text).toBe('上游目前不提供此資料，更新已暫停');
    FORBIDDEN.forEach((w) => expect(seg.text).not.toContain(w));
  });

  it('unknown_degraded 不得稱 terminal 也不得承諾重試', () => {
    const seg = buildBsrSegment(payload({ bsr_provider_state: 'unknown_degraded' }));
    expect(seg.state).toBe('unknown_degraded');
    expect(seg.text).toContain('暫不承諾更新時間');
    expect(seg.text).not.toContain('自動重試');
    expect(seg.text).not.toContain('中止');
  });

  it('retryable 才能說同步中／自動重試', () => {
    const seg = buildBsrSegment(payload({ bsr_provider_state: 'retryable' }));
    expect(seg.state).toBe('syncing');
    expect(seg.text).toContain('自動重試');
  });

  it('ineligible', () => {
    const seg = buildBsrSegment(payload({ bsr_provider_state: 'ineligible', bsr_as_of: null }));
    expect(seg.state).toBe('ineligible');
    expect(seg.text).toContain('不適用');
  });

  it('fresh', () => {
    const seg = buildBsrSegment(
      payload({ bsr_as_of: '2026-08-17', bsr_freshness_status: 'fresh', bsr_provider_state: 'fresh' }),
    );
    expect(seg.state).toBe('fresh');
    expect(seg.text).toBe('2026/08/17');
  });

  it('無 provider_state（舊 endpoint）維持既有行為', () => {
    const seg = buildBsrSegment(payload({}));
    expect(seg.state).toBe('syncing');
  });
});

describe('bsrHeaderLabel × provider_state（無資料時才顯示）', () => {
  it('terminal', () => {
    const l = bsrHeaderLabel(
      { eligible: true, status: 'pending', next_run_at: '2026-08-17T12:10:00Z', provider_state: 'terminal_provider_rejected' },
      false,
    );
    expect(l?.text).toBe('上游目前不提供此資料，更新已暫停');
    expect(l?.tone).toBe('error');
  });

  it('unknown_degraded', () => {
    const l = bsrHeaderLabel(
      { eligible: true, status: 'pending', next_run_at: null, provider_state: 'unknown_degraded' },
      false,
    );
    expect(l?.text).toContain('待確認');
    FORBIDDEN.forEach((w) => expect(l?.text).not.toContain(w));
  });

  it('retryable pending 維持排程文案', () => {
    const l = bsrHeaderLabel({ eligible: true, status: 'pending', next_run_at: null, provider_state: 'retryable' }, false);
    expect(l?.text).toBe('已排入佇列');
  });
});
