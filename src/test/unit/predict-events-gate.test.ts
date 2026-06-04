/**
 * Predict-Events Gate — 規則窮舉測試
 *
 * 對應 supabase/functions/checkup-predict-events/index.ts L435–L513 的 gate 區塊。
 * 涵蓋：
 *  - 免費 tier：line_free / none / 空字串 → 沒做過 daily 放行，做過則 FREE_TIER_PREDICT_DISABLED
 *  - 付費 tier：pro / basic / tester
 *      ‧ 視窗外 → PAID_TIER_OUT_OF_WINDOW
 *      ‧ 視窗內未用 → 放行
 *      ‧ 視窗內已用 → PAID_TIER_DAILY_USED
 *  - 視窗邊界：13:29 / 13:30 / 13:39 / 13:40
 *  - 時區：UTC 05:30 == Taipei 13:30
 *  - nextPredictWindow：視窗結束後跳隔日
 */
import { describe, it, expect } from 'vitest';
import {
  evaluatePredictGate,
  isInPredictWindow,
  isFreeTier,
  nextPredictWindow,
  formatNextWindowLabel,
  toTaipei,
  FREE_TIERS,
  PREDICT_WINDOW_START_MIN,
  PREDICT_WINDOW_END_MIN,
} from '@/checkup/lib/predictEventsGate';

const UTC = (iso: string) => new Date(iso + 'Z');

describe('toTaipei', () => {
  it('UTC 05:30 → Taipei 13:30 same day', () => {
    const tp = toTaipei(UTC('2026-06-04T05:30:00'));
    expect(tp.ymd).toBe('2026-06-04');
    expect(tp.minutes).toBe(PREDICT_WINDOW_START_MIN);
  });
  it('UTC 16:00 → Taipei 00:00 next day', () => {
    const tp = toTaipei(UTC('2026-06-03T16:00:00'));
    expect(tp.ymd).toBe('2026-06-04');
    expect(tp.minutes).toBe(0);
  });
});

describe('isInPredictWindow — 邊界窮舉', () => {
  const cases: Array<[string, boolean, string]> = [
    ['2026-06-04T05:29:59', false, '13:29:59 視窗前一秒'],
    ['2026-06-04T05:30:00', true,  '13:30:00 視窗起點（含）'],
    ['2026-06-04T05:35:00', true,  '13:35 視窗中段'],
    ['2026-06-04T05:39:59', true,  '13:39:59 視窗最後一秒'],
    ['2026-06-04T05:40:00', false, '13:40:00 視窗結束（不含）'],
    ['2026-06-04T05:50:00', false, '13:50 視窗後'],
    ['2026-06-04T00:00:00', false, 'Taipei 08:00 早盤'],
    ['2026-06-03T17:30:00', false, 'Taipei 01:30 凌晨'],
  ];
  for (const [iso, expected, label] of cases) {
    it(`${label}（UTC ${iso}）→ ${expected}`, () => {
      expect(isInPredictWindow(UTC(iso))).toBe(expected);
    });
  }
});

describe('FREE_TIERS 常數', () => {
  it('包含 line_free / none / 空字串', () => {
    expect(FREE_TIERS.has('line_free')).toBe(true);
    expect(FREE_TIERS.has('none')).toBe(true);
    expect(FREE_TIERS.has('')).toBe(true);
  });
  it('不包含 pro / basic / tester', () => {
    expect(FREE_TIERS.has('pro')).toBe(false);
    expect(FREE_TIERS.has('basic')).toBe(false);
    expect(FREE_TIERS.has('tester')).toBe(false);
  });
});

describe('isFreeTier — 全 tier 列舉', () => {
  it.each([
    ['line_free', true],
    ['none', true],
    ['', true],
    [null, true],
    [undefined, true],
    ['pro', false],
    ['basic', false],
    ['tester', false],
  ])('tier=%s → %s', (tier, expected) => {
    expect(isFreeTier(tier as string)).toBe(expected);
  });
});

describe('evaluatePredictGate — 免費 tier', () => {
  const inWindow = UTC('2026-06-04T05:35:00');
  const outWindow = UTC('2026-06-04T03:00:00');

  for (const tier of ['line_free', 'none', '']) {
    it(`${tier || '(empty)'} 沒做過 daily-analysis → 放行（不論視窗）`, () => {
      expect(evaluatePredictGate({ tier, hasDailyAnalysis: false, paidUsedToday: false, now: inWindow }))
        .toEqual({ allowed: true });
      expect(evaluatePredictGate({ tier, hasDailyAnalysis: false, paidUsedToday: false, now: outWindow }))
        .toEqual({ allowed: true });
    });

    it(`${tier || '(empty)'} 做過 daily-analysis → FREE_TIER_PREDICT_DISABLED`, () => {
      const d = evaluatePredictGate({ tier, hasDailyAnalysis: true, paidUsedToday: false, now: inWindow });
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        expect(d.code).toBe('FREE_TIER_PREDICT_DISABLED');
        expect(d.message).toContain('收盤分析');
      }
    });
  }
});

describe('evaluatePredictGate — 付費 tier', () => {
  const inWindow = UTC('2026-06-04T05:35:00');
  const outWindow = UTC('2026-06-04T03:00:00');

  for (const tier of ['pro', 'basic', 'tester']) {
    it(`${tier} 視窗外 → PAID_TIER_OUT_OF_WINDOW（即使未使用）`, () => {
      const d = evaluatePredictGate({ tier, hasDailyAnalysis: false, paidUsedToday: false, now: outWindow });
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        expect(d.code).toBe('PAID_TIER_OUT_OF_WINDOW');
        expect(d.message).toContain('13:30');
        expect(d.message).toContain('13:40');
        expect('nextWindowUtc' in d ? d.nextWindowUtc : '').toMatch(/^\d{4}-\d{2}-\d{2}T05:30:00\.000Z$/);
      }
    });

    it(`${tier} 視窗內未使用 → 放行`, () => {
      expect(evaluatePredictGate({ tier, hasDailyAnalysis: false, paidUsedToday: false, now: inWindow }))
        .toEqual({ allowed: true });
    });

    it(`${tier} 視窗內今日已用 → PAID_TIER_DAILY_USED`, () => {
      const d = evaluatePredictGate({ tier, hasDailyAnalysis: false, paidUsedToday: true, now: inWindow });
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        expect(d.code).toBe('PAID_TIER_DAILY_USED');
        expect(d.message).toContain('明日');
      }
    });

    it(`${tier} hasDailyAnalysis 對付費 tier 無影響`, () => {
      expect(evaluatePredictGate({ tier, hasDailyAnalysis: true, paidUsedToday: false, now: inWindow }))
        .toEqual({ allowed: true });
    });
  }
});

describe('nextPredictWindow', () => {
  it('視窗前 → 今日 13:30 Taipei (= 05:30 UTC)', () => {
    const r = nextPredictWindow(UTC('2026-06-04T03:00:00'));
    expect(r.toISOString()).toBe('2026-06-04T05:30:00.000Z');
  });
  it('視窗中 → 仍是今日 13:30', () => {
    const r = nextPredictWindow(UTC('2026-06-04T05:35:00'));
    expect(r.toISOString()).toBe('2026-06-04T05:30:00.000Z');
  });
  it('視窗結束 → 跳隔日 13:30', () => {
    const r = nextPredictWindow(UTC('2026-06-04T05:40:00'));
    expect(r.toISOString()).toBe('2026-06-05T05:30:00.000Z');
  });
  it('深夜 Taipei 02:00 (UTC 18:00) → 隔日 13:30', () => {
    const r = nextPredictWindow(UTC('2026-06-03T18:00:00'));
    expect(r.toISOString()).toBe('2026-06-04T05:30:00.000Z');
  });
});

describe('formatNextWindowLabel', () => {
  it('格式為 YYYY/MM/DD 13:30（台灣時間）', () => {
    expect(formatNextWindowLabel('2026-06-05T05:30:00.000Z'))
      .toBe('2026/06/05 13:30（台灣時間）');
  });
  it('UTC 跨日：2026-06-03T16:00 UTC = Taipei 2026-06-04 00:00', () => {
    expect(formatNextWindowLabel('2026-06-03T16:00:00.000Z'))
      .toBe('2026/06/04 13:30（台灣時間）');
  });
  it('無效字串 → —', () => {
    expect(formatNextWindowLabel('not-a-date')).toBe('—');
  });
});

describe('視窗常數同步檢查（避免漂移）', () => {
  it('PREDICT_WINDOW_START_MIN === 13:30', () => {
    expect(PREDICT_WINDOW_START_MIN).toBe(810);
  });
  it('PREDICT_WINDOW_END_MIN === 13:40', () => {
    expect(PREDICT_WINDOW_END_MIN).toBe(820);
  });
  it('視窗長度為 10 分鐘', () => {
    expect(PREDICT_WINDOW_END_MIN - PREDICT_WINDOW_START_MIN).toBe(10);
  });
});
