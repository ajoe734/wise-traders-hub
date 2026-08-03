import { describe, it, expect } from 'vitest';
import { normalizeBars, type Bar } from '../volumeAnalysis';
import {
  detectReversalSignals,
  selectActiveReversal,
  buildReversalLine,
  reversalByDate,
  shouldShowReversalLine,
  positionContext,
  REVERSAL_VOL_RATIO,
} from '../reversalSignals';

const d = (i: number) => `2026-06-${String(i + 1).padStart(2, '0')}`;

type Raw = { open: number; high: number; low: number; close: number; volume: number | null };

function bars(rows: Raw[]): Bar[] {
  return normalizeBars(rows.map((r, i) => ({ date: d(i), ...r })), 'shares');
}

/** 25 根平盤基準（收 100、量 1,000,000 股 = 1000 張） */
function base(n = 25, price = 100, volume: number | null = 1_000_000): Raw[] {
  return Array.from({ length: n }, () => ({
    open: price, high: price * 1.004, low: price * 0.996, close: price, volume,
  }));
}

/** 讓 index 20..24 之前形成短期跌勢（-5%） */
function withDowntrend(rows: Raw[], from = 15): Raw[] {
  const out = rows.map((r) => ({ ...r }));
  for (let i = from; i < out.length; i += 1) {
    const p = 100 * (1 - 0.012 * (i - from + 1));
    out[i] = { open: p, high: p * 1.004, low: p * 0.996, close: p, volume: out[i].volume };
  }
  return out;
}

function withUptrend(rows: Raw[], from = 15): Raw[] {
  const out = rows.map((r) => ({ ...r }));
  for (let i = from; i < out.length; i += 1) {
    const p = 100 * (1 + 0.012 * (i - from + 1));
    out[i] = { open: p, high: p * 1.004, low: p * 0.996, close: p, volume: out[i].volume };
  }
  return out;
}

// 長下影：實體小但非 doji、下影 >= 實體 2 倍、收在上半部
const HAMMER = (p: number, volume: number | null = 1_500_000): Raw => ({
  open: p * 0.995, high: p * 1.01, low: p * 0.94, close: p * 1.005, volume,
});
// 長上影：上影 >= 實體 2 倍、收在下半部
const SHOOTING = (p: number, volume: number | null = 1_500_000): Raw => ({
  open: p * 1.005, high: p * 1.06, low: p * 0.99, close: p * 0.995, volume,
});

describe('detectReversalSignals — 四種型態', () => {
  it('低檔放量長下影：命中 hammer / bullish / pending', () => {
    const rows = withDowntrend(base(24));
    rows.push(HAMMER(88));
    const sigs = detectReversalSignals(bars(rows));
    expect(sigs).toHaveLength(1);
    expect(sigs[0].kind).toBe('hammer');
    expect(sigs[0].direction).toBe('bullish');
    expect(sigs[0].state).toBe('pending');
    expect(sigs[0].signalDate).toBe(d(24));
    expect(sigs[0].triggerPrice).toBeCloseTo(88 * 1.01, 4);
    expect(sigs[0].relVolume).toBeGreaterThanOrEqual(REVERSAL_VOL_RATIO);
    expect(sigs[0].reasons.join()).toMatch(/下影線/);
  });

  it('低檔放量多頭吞噬：命中 bullish_engulfing', () => {
    const rows = withDowntrend(base(23));
    rows.push({ open: 88, high: 88.2, low: 86.5, close: 86.8, volume: 1_000_000 }); // 空方
    rows.push({ open: 86.5, high: 89.5, low: 86.4, close: 89.2, volume: 1_600_000 }); // 吞噬
    const sigs = detectReversalSignals(bars(rows));
    const last = sigs[sigs.length - 1];
    expect(last.kind).toBe('bullish_engulfing');
    expect(last.direction).toBe('bullish');
    expect(last.triggerPrice).toBeCloseTo(89.5, 4);
  });

  it('高檔爆量長上影：命中 shooting_star / bearish', () => {
    const rows = withUptrend(base(24));
    rows.push(SHOOTING(112));
    const sigs = detectReversalSignals(bars(rows));
    const last = sigs[sigs.length - 1];
    expect(last.kind).toBe('shooting_star');
    expect(last.direction).toBe('bearish');
    expect(last.triggerPrice).toBeCloseTo(112 * 0.99, 4);
  });

  it('高檔放量空頭吞噬：命中 bearish_engulfing', () => {
    const rows = withUptrend(base(23));
    rows.push({ open: 110, high: 112.5, low: 109.8, close: 112, volume: 1_000_000 }); // 多方
    rows.push({ open: 112.6, high: 113, low: 109, close: 109.5, volume: 1_600_000 }); // 吞噬
    const sigs = detectReversalSignals(bars(rows));
    const last = sigs[sigs.length - 1];
    expect(last.kind).toBe('bearish_engulfing');
    expect(last.triggerPrice).toBeCloseTo(109, 4);
  });
});

describe('detectReversalSignals — 不得誤報', () => {
  it('位置不對（高檔出現長下影）不算低檔訊號', () => {
    const rows = withUptrend(base(24));
    rows.push(HAMMER(112));
    const sigs = detectReversalSignals(bars(rows));
    expect(sigs.filter((s) => s.kind === 'hammer')).toHaveLength(0);
  });

  it('位置不對（低檔長上影）不算高檔訊號', () => {
    const rows = withDowntrend(base(24));
    rows.push(SHOOTING(88));
    expect(detectReversalSignals(bars(rows)).filter((s) => s.kind === 'shooting_star')).toHaveLength(0);
  });

  it('相對量能 < 1.2 不得誤報', () => {
    const rows = withDowntrend(base(24));
    rows.push(HAMMER(88, 1_100_000));
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });

  it('形狀不足（下影線未達實體 2 倍）不算', () => {
    const rows = withDowntrend(base(24));
    rows.push({ open: 88, high: 90, low: 87.6, close: 89.8, volume: 1_600_000 });
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });
});

describe('detectReversalSignals — edge cases', () => {
  it('doji（實體接近 0）不判形態', () => {
    const rows = withDowntrend(base(24));
    rows.push({ open: 88, high: 88.05, low: 84, close: 88.001, volume: 1_600_000 });
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });

  it('high = low（零區間）不判形態', () => {
    const rows = withDowntrend(base(24));
    rows.push({ open: 88, high: 88, low: 88, close: 88, volume: 1_600_000 });
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });

  it('缺量（null）不產生訊號', () => {
    const rows = withDowntrend(base(24));
    rows.push(HAMMER(88, null));
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });

  it('視窗內任一日缺量即不產生訊號', () => {
    const rows = withDowntrend(base(24));
    rows[10].volume = null;
    rows.push(HAMMER(88));
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });

  it('少於 21 根（20 日均量不可得）不產生訊號', () => {
    const rows = withDowntrend(base(19), 12);
    rows.push(HAMMER(88));
    expect(detectReversalSignals(bars(rows))).toHaveLength(0);
  });

  it('空輸入安全', () => {
    expect(detectReversalSignals(null)).toEqual([]);
    expect(detectReversalSignals([])).toEqual([]);
  });
});

describe('確認規則 pending / confirmed / failed', () => {
  const hammerAt24 = () => {
    const rows = withDowntrend(base(24));
    rows.push(HAMMER(88));
    return rows;
  };

  it('後續收盤站上訊號 high → confirmed', () => {
    const rows = hammerAt24();
    rows.push({ open: 89, high: 92, low: 88.5, close: 91, volume: 1_200_000 });
    const s = detectReversalSignals(bars(rows))[0];
    expect(s.state).toBe('confirmed');
    expect(s.resolvedDate).toBe(d(25));
  });

  it('後續收盤跌破訊號 low → failed', () => {
    const rows = hammerAt24();
    rows.push({ open: 84, high: 84.5, low: 80, close: 80.5, volume: 1_200_000 });
    const s = detectReversalSignals(bars(rows))[0];
    expect(s.state).toBe('failed');
  });

  it('空方訊號：收盤跌破 low 才 confirmed，站上 high 為 failed', () => {
    const up = withUptrend(base(24));
    up.push(SHOOTING(112));
    const conf = [...up, { open: 111, high: 111.5, low: 109, close: 109.5, volume: 1_200_000 }];
    expect(detectReversalSignals(bars(conf))[0].state).toBe('confirmed');
    const fail = [...up, { open: 119, high: 121, low: 118.5, close: 120, volume: 1_200_000 }];
    expect(detectReversalSignals(bars(fail))[0].state).toBe('failed');
  });
});

describe('selectActiveReversal — 最多一個且 deterministic', () => {
  it('failed 不顯示', () => {
    const rows = withDowntrend(base(24));
    rows.push(HAMMER(88));
    rows.push({ open: 84, high: 84.5, low: 80, close: 80.5, volume: 1_200_000 });
    expect(selectActiveReversal(detectReversalSignals(bars(rows)))).toBeNull();
  });

  it('confirmed 優先於 pending', () => {
    const sigs = [
      { kind: 'hammer', direction: 'bullish', state: 'pending', signalDate: '2026-06-20', triggerPrice: 10, reasons: [], index: 21, relVolume: 1.5, resolvedDate: null, ageBars: 1, confirmedAgeBars: 0 },
      { kind: 'shooting_star', direction: 'bearish', state: 'confirmed', signalDate: '2026-06-10', triggerPrice: 20, reasons: [], index: 15, relVolume: 1.5, resolvedDate: '2026-06-11', ageBars: 5, confirmedAgeBars: 1 },
    ] as any;
    expect(selectActiveReversal(sigs)!.kind).toBe('shooting_star');
  });

  it('同日多型態只回一個，且優先序 deterministic（多次呼叫相同）', () => {
    // 同一根同時符合 shooting_star 與 bearish_engulfing → 取 shooting_star
    const rows = withUptrend(base(23));
    rows.push({ open: 110, high: 112.5, low: 109.8, close: 112.4, volume: 1_000_000 });
    rows.push({ open: 112.5, high: 118, low: 109.5, close: 109.9, volume: 1_800_000 });
    const a = detectReversalSignals(bars(rows));
    const b = detectReversalSignals(bars(rows));
    const last = a[a.length - 1];
    expect(last.kind).toBe('shooting_star');
    expect(a).toEqual(b);
    expect(a.filter((s) => s.signalDate === last.signalDate)).toHaveLength(1);
  });

  it('pending 超過 5 個交易日即不再常駐', () => {
    const sigs = [{ state: 'pending', kind: 'hammer', index: 3, ageBars: 6, confirmedAgeBars: 0 }] as any;
    expect(selectActiveReversal(sigs)).toBeNull();
  });
});

describe('文案與顯示優先序', () => {
  const pending = {
    kind: 'hammer', direction: 'bullish', state: 'pending', signalDate: '2026-06-25',
    triggerPrice: 3685, reasons: [], index: 24, relVolume: 1.5, resolvedDate: null,
    ageBars: 0, confirmedAgeBars: 0,
  } as any;

  it('多方待確認：轉折觀察 + 站上 trigger', () => {
    expect(buildReversalLine(pending)).toBe('轉折觀察 · 低檔放量長下影，站上 3,685.00 才確認');
  });

  it('空方待確認：轉弱觀察 + 跌破 trigger', () => {
    const s = { ...pending, kind: 'shooting_star', direction: 'bearish', triggerPrice: 3295 };
    expect(buildReversalLine(s)).toBe('轉弱觀察 · 高檔爆量長上影，跌破 3,295.00 才確認');
  });

  it('confirmed 才可寫已確認；failed 與 null 不出文字', () => {
    expect(buildReversalLine({ ...pending, state: 'confirmed' })).toBe('止跌訊號已確認 · 低檔放量長下影');
    expect(buildReversalLine({ ...pending, kind: 'shooting_star', direction: 'bearish', state: 'confirmed' }))
      .toBe('轉弱訊號已確認 · 高檔爆量長上影');
    expect(buildReversalLine({ ...pending, state: 'failed' })).toBeNull();
    expect(buildReversalLine(null)).toBeNull();
  });

  it('突破狀態存在時不顯示第二行', () => {
    expect(shouldShowReversalLine('breakout_confirmed')).toBe(false);
    expect(shouldShowReversalLine('failed_breakout')).toBe(false);
    expect(shouldShowReversalLine('below')).toBe(true);
    expect(shouldShowReversalLine(null)).toBe(true);
  });

  it('reversalByDate 只在命中日給值', () => {
    const map = reversalByDate([pending]);
    expect(map['2026-06-25']).toBe('低檔放量長下影 · 待確認');
    expect(map['2026-06-24']).toBeUndefined();
  });
});

describe('positionContext 可測試定義', () => {
  it('近期低檔／短期跌勢分別可判定', () => {
    const b = bars(withDowntrend(base(25)));
    const ctx = positionContext(b, b.length - 1);
    expect(ctx.nearLow).toBe(true);
    expect(ctx.downtrend).toBe(true);
    expect(ctx.uptrend).toBe(false);
  });

  it('接近壓力區以傳入 zone 判定，不硬編碼價格', () => {
    const b = bars(base(25, 100));
    const near = positionContext(b, b.length - 1, { resistanceZone: { lower: 100.5, upper: 102 } });
    const far = positionContext(b, b.length - 1, { resistanceZone: { lower: 130, upper: 132 } });
    expect(near.nearResistance).toBe(true);
    expect(far.nearResistance).toBe(false);
  });
});
