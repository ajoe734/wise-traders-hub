import { describe, it, expect } from 'vitest';
import {
  deriveChipsFacts,
  planAutoRefresh,
  reduceAutoRefreshResult,
  planPendingPoll,
  autoBackoffMs,
  AUTO_MAX_FAILURES,
  AUTO_MAX_BACKOFF_MS,
  EMPTY_CHIPS_FACTS,
} from '../chipsLifecycle';

const base = {
  valid: true,
  stale: true,
  fetching: false,
  hasResult: true,
  online: true,
  visible: true,
  failures: 0,
  lastAutoAt: 0,
  now: 1_000_000,
};

describe('deriveChipsFacts', () => {
  it('空 payload 回傳空事實', () => {
    expect(deriveChipsFacts(null)).toEqual(EMPTY_CHIPS_FACTS);
  });

  it('資料點不足時判定 sparse，並攤平 syncStatus / eligible / pending', () => {
    const facts = deriveChipsFacts({
      series: {
        institutional_daily: new Array(10).fill({}),
        bsr_concentration: new Array(2).fill({}),
      },
      bsr_sync_status: { status: 'running', eligible: true },
    } as never);
    expect(facts.instDays).toBe(10);
    expect(facts.bsrDays).toBe(2);
    expect(facts.sparse).toBe(true);
    expect(facts.pending).toBe(true);
    expect(facts.eligible).toBe(true);
  });

  it('資料充足即非 sparse，且 done 不算 pending', () => {
    const facts = deriveChipsFacts({
      series: {
        institutional_daily: new Array(30).fill({}),
        bsr_concentration: new Array(30).fill({}),
      },
      bsr_sync_status: { status: 'done', eligible: true },
      readiness: { institutional: { '60': { state: 'ready' }, '20': { state: 'ready' } } },
    } as never);
    expect(facts.sparse).toBe(false);
    expect(facts.pending).toBe(false);
    expect(facts.satisfied).toBe(true);
  });
});

describe('planAutoRefresh', () => {
  it('新鮮 / 抓取中 / 離線 / 無結果 / 無效 都不排程', () => {
    for (const patch of [
      { stale: false }, { fetching: true }, { online: false }, { hasResult: false }, { valid: false },
    ]) {
      const plan = planAutoRefresh({ ...base, ...patch });
      expect(plan.schedule).toBe(false);
      expect(plan.state).toBe('idle');
    }
  });

  it('過期且首次 → 立即排程且不顯示倒數', () => {
    const plan = planAutoRefresh(base);
    expect(plan).toMatchObject({ schedule: true, delayMs: 0, state: 'idle', nextAutoAt: null });
  });

  it('失敗後以指數退避排程並回報 failed', () => {
    const plan = planAutoRefresh({ ...base, failures: 2, lastAutoAt: base.now });
    expect(plan.state).toBe('failed');
    expect(plan.schedule).toBe(true);
    expect(plan.delayMs).toBe(60_000);
    expect(plan.nextAutoAt).toBe(base.now + 60_000);
  });

  it('達失敗上限 → exhausted 且不再排程', () => {
    const plan = planAutoRefresh({ ...base, failures: AUTO_MAX_FAILURES });
    expect(plan).toMatchObject({ state: 'exhausted', schedule: false });
  });

  it('分頁隱藏 → paused 且不排程（優先序低於 exhausted）', () => {
    expect(planAutoRefresh({ ...base, visible: false })).toMatchObject({
      state: 'paused', schedule: false,
    });
    expect(planAutoRefresh({ ...base, visible: false, failures: AUTO_MAX_FAILURES }).state)
      .toBe('exhausted');
  });

  it('退避有上限', () => {
    expect(autoBackoffMs(0)).toBe(0);
    expect(autoBackoffMs(1)).toBe(30_000);
    expect(autoBackoffMs(99)).toBe(AUTO_MAX_BACKOFF_MS);
  });
});

describe('reduceAutoRefreshResult', () => {
  it('成功歸零', () => {
    expect(reduceAutoRefreshResult(3, true)).toEqual({ failures: 0, state: 'idle', nextAutoAt: null });
  });
  it('失敗累加，達上限轉 exhausted', () => {
    expect(reduceAutoRefreshResult(0, false).state).toBe('failed');
    expect(reduceAutoRefreshResult(AUTO_MAX_FAILURES - 1, false).state).toBe('exhausted');
  });
});

describe('planPendingPoll', () => {
  it('非 pending 不輪詢', () => {
    expect(planPendingPoll(EMPTY_CHIPS_FACTS, 0)).toBeNull();
  });
  it('pending 時回傳退避延遲，且隨嘗試次數變長', () => {
    const facts = { ...EMPTY_CHIPS_FACTS, pending: true };
    const first = planPendingPoll(facts, 0)!;
    const later = planPendingPoll(facts, 3)!;
    expect(first).toBeGreaterThan(0);
    expect(later).toBeGreaterThanOrEqual(first);
  });
});
