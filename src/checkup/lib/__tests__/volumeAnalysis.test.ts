/**
 * TDD seam：30 日走勢卡的量價分析純函式。
 * 規格來自「持倉細節 30 日走勢量價分析」需求：對齊、單位、MA、相對量能、
 * 量價狀態、壓力分群與突破判讀，全部不碰 DOM。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBars,
  rollingAvgVolumeLots,
  computeVolumeStats,
  classifyPriceVolume,
  findResistanceZone,
  resistanceDistance,
  breakoutState,
  buildVolumeAnalysis,
} from '../volumeAnalysis';

const d = (i: number) => {
  const base = Date.UTC(2026, 0, 1);
  return new Date(base + i * 86400_000).toISOString().slice(0, 10);
};

/** 造 n 根等量 K 棒，close 由 closes 指定（缺則沿用前收）。 */
function bars(
  spec: Array<{ close: number; volume?: number | null; high?: number; low?: number; open?: number; date?: string }>,
) {
  return spec.map((s, i) => ({
    date: s.date ?? d(i),
    open: s.open ?? s.close,
    high: s.high ?? Math.max(s.open ?? s.close, s.close),
    low: s.low ?? Math.min(s.open ?? s.close, s.close),
    close: s.close,
    volume: s.volume === undefined ? 1_000_000 : s.volume,
  }));
}

describe('normalizeBars', () => {
  it('依日期排序並去除重複日期（後到的覆蓋）', () => {
    const out = normalizeBars([
      { date: '2026-01-03', open: 1, high: 1, low: 1, close: 3, volume: 3000 },
      { date: '2026-01-01', open: 1, high: 1, low: 1, close: 1, volume: 1000 },
      { date: '2026-01-03', open: 1, high: 1, low: 1, close: 9, volume: 9000 },
      { date: '2026-01-02', open: 1, high: 1, low: 1, close: 2, volume: 2000 },
    ]);
    expect(out.map((b) => b.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(out[2].close).toBe(9);
  });

  it('缺量不補 0，一律轉成 null（0 視為無效量）', () => {
    const out = normalizeBars([
      { date: '2026-01-01', open: 1, high: 1, low: 1, close: 1 },
      { date: '2026-01-02', open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { date: '2026-01-03', open: 1, high: 1, low: 1, close: 1, volume: -5 },
    ]);
    expect(out.map((b) => b.volume)).toEqual([null, null, null]);
  });

  it('丟掉 OHLC 不完整或無日期的資料', () => {
    const out = normalizeBars([
      { date: '2026-01-01', open: 0, high: 0, low: 0, close: 0, volume: 1 } as any,
      { open: 1, high: 1, low: 1, close: 1, volume: 1 } as any,
      { date: '2026-01-02', open: 1, high: 2, low: 1, close: 2, volume: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-01-02');
  });
});

describe('rollingAvgVolumeLots', () => {
  const b = normalizeBars(bars([
    { close: 10, volume: 1_000_000 },
    { close: 10, volume: 2_000_000 },
    { close: 10, volume: 3_000_000 },
  ]));

  it('股 → 張換算（1000 股 = 1 張），不重複除以 1000', () => {
    // (1000+2000+3000)/3 = 2000 張
    expect(rollingAvgVolumeLots(b, 3).value).toBe(2000);
  });

  it('excludeLast 讓分母不含當日', () => {
    expect(rollingAvgVolumeLots(b, 2, { excludeLast: true }).value).toBe(1500);
  });

  it('資料不足回 null 並回報可用根數', () => {
    const r = rollingAvgVolumeLots(b, 20);
    expect(r.value).toBeNull();
    expect(r.available).toBe(3);
    expect(r.required).toBe(20);
  });

  it('視窗內有缺量時不當作 0，回 null', () => {
    const withHole = normalizeBars(bars([
      { close: 10, volume: 1_000_000 },
      { close: 10, volume: null },
      { close: 10, volume: 3_000_000 },
    ]));
    expect(rollingAvgVolumeLots(withHole, 3).value).toBeNull();
  });
});

describe('computeVolumeStats', () => {
  const many = normalizeBars(
    bars(Array.from({ length: 25 }, (_, i) => ({ close: 10 + i * 0.1, volume: 1_000_000 }))),
  );

  it('收盤後：相對量能 = 當日量 / 前 20 完整交易日均量（不含當日）', () => {
    const withSpike = normalizeBars(
      bars(Array.from({ length: 25 }, (_, i) => ({
        close: 10 + i * 0.1,
        volume: i === 24 ? 1_500_000 : 1_000_000,
      }))),
    );
    const s = computeVolumeStats(withSpike, { intraday: false });
    expect(s.ma20Lots).toBe(1000);
    expect(s.todayLots).toBe(1500);
    expect(s.relVolume).toBeCloseTo(1.5, 5);
    expect(s.intraday).toBe(false);
  });

  it('盤中：不得用未收盤累積量除完整日均量', () => {
    const s = computeVolumeStats(many, { intraday: true });
    expect(s.relVolume).toBeNull();
    expect(s.intraday).toBe(true);
    expect(s.todayLabel).toBe('盤中成交量');
  });

  it('資料不足時給「資料不足 N/20」而非誤導數字', () => {
    const few = normalizeBars(bars(Array.from({ length: 4 }, () => ({ close: 10, volume: 1_000_000 }))));
    const s = computeVolumeStats(few, { intraday: false });
    expect(s.ma20Lots).toBeNull();
    expect(s.ma20Insufficient).toBe('資料不足 3/20');
    expect(s.relVolume).toBeNull();
  });

  it('完全沒有成交量資料時 hasVolume=false', () => {
    const novol = normalizeBars(bars(Array.from({ length: 10 }, () => ({ close: 10, volume: null }))));
    expect(computeVolumeStats(novol, { intraday: false }).hasVolume).toBe(false);
  });
});

describe('classifyPriceVolume', () => {
  const make = (lastClose: number, lastVol: number) => normalizeBars(
    bars([
      ...Array.from({ length: 21 }, () => ({ close: 10, volume: 1_000_000 })),
      { close: lastClose, volume: lastVol },
    ]),
  );

  it('價漲量增', () => {
    expect(classifyPriceVolume(make(11, 2_000_000), { intraday: false }).state).toBe('up_vol_up');
  });
  it('價漲量縮', () => {
    expect(classifyPriceVolume(make(11, 500_000), { intraday: false }).state).toBe('up_vol_down');
  });
  it('價跌量增', () => {
    expect(classifyPriceVolume(make(9, 2_000_000), { intraday: false }).state).toBe('down_vol_up');
  });
  it('價跌量縮', () => {
    expect(classifyPriceVolume(make(9, 500_000), { intraday: false }).state).toBe('down_vol_down');
  });
  it('平盤是中性狀態', () => {
    const r = classifyPriceVolume(make(10, 2_000_000), { intraday: false });
    expect(r.state).toBe('flat');
    expect(r.label).toBe('平盤');
  });
  it('盤中或資料不足顯示「尚無法判斷」', () => {
    expect(classifyPriceVolume(make(11, 2_000_000), { intraday: true }).label).toBe('尚無法判斷');
    const few = normalizeBars(bars([{ close: 10 }, { close: 11 }]));
    expect(classifyPriceVolume(few, { intraday: false }).label).toBe('尚無法判斷');
  });
});

// ── 壓力區 ───────────────────────────────────────────────
/** 造一段有兩個等高 pivot high 的走勢。 */
function pivotSeries() {
  const closes = [
    100, 101, 102, 103, 102, 101, 100, 99, 100, 101,
    103, 108, 104, 102, 101, 100, 101, 102, 104, 107.9,
    103, 101, 100, 99, 98, 99, 100, 101, 102, 103,
  ];
  return normalizeBars(closes.map((c, i) => ({
    date: d(i), open: c, high: c, low: c - 1, close: c, volume: 1_000_000,
  })));
}

describe('findResistanceZone', () => {
  it('把 2% 內的 pivot highs 分群，選現價上方最近、至少 2 次觸及者', () => {
    const z = findResistanceZone(pivotSeries(), 103)!;
    expect(z.basis).toBe('cluster');
    expect(z.touches).toBe(2);
    expect(z.lower).toBeCloseTo(107.9, 5);
    expect(z.upper).toBeCloseTo(108, 5);
    expect(z.lookback).toBe(30);
  });

  it('只有 1 次觸及時只能標「參考壓力」', () => {
    const closes = [100, 101, 102, 103, 106, 103, 102, 101, 100, 99, 98, 97];
    const b = normalizeBars(closes.map((c, i) => ({ date: d(i), open: c, high: c, low: c - 1, close: c })));
    const z = findResistanceZone(b, 97)!;
    expect(z.basis).toBe('swing_high');
    expect(z.touches).toBe(1);
    expect(z.lower).toBeCloseTo(106, 5);
  });

  it('沒有任何 pivot high 回 null', () => {
    const b = normalizeBars(Array.from({ length: 10 }, (_, i) => ({
      date: d(i), open: 100 - i, high: 100 - i, low: 99 - i, close: 100 - i,
    })));
    expect(findResistanceZone(b, 90)).toBeNull();
  });

  it('只看最近 60 個交易日（更早的極端高點不算）', () => {
    const long = Array.from({ length: 90 }, (_, i) => ({
      date: d(i), open: 100, high: i === 5 ? 300 : i === 70 ? 150 : 100, low: 99, close: 100,
    }));
    const z = findResistanceZone(normalizeBars(long), 100)!;
    expect(z.lookback).toBe(60);
    expect(z.upper).toBe(150);
  });
});

describe('resistanceDistance', () => {
  const zone = { lower: 110, upper: 112, touches: 2, lookback: 60, basis: 'cluster' as const };
  it('現價下方回距離百分比', () => {
    expect(resistanceDistance(zone, 100)!.pct).toBeCloseTo(0.1, 5);
    expect(resistanceDistance(zone, 100)!.state).toBe('below');
  });
  it('現價落在區間內為「測試壓力」', () => {
    expect(resistanceDistance(zone, 111)!.state).toBe('testing');
  });
  it('現價高於上緣為突破狀態', () => {
    expect(resistanceDistance(zone, 115)!.state).toBe('above');
  });
});

describe('breakoutState', () => {
  const zone = { lower: 110, upper: 112, touches: 2, lookback: 60, basis: 'cluster' as const };
  const seq = (closes: number[]) => normalizeBars(closes.map((c, i) => ({
    date: d(i), open: c, high: c, low: c - 1, close: c, volume: 1_000_000,
  })));

  it('站上上緣且相對量能 >= 1.5 → 帶量突破', () => {
    const r = breakoutState({ bars: seq([108, 109, 115]), zone, relVolume: 1.6 });
    expect(r.state).toBe('breakout_confirmed');
    expect(r.label).toBe('帶量突破');
  });

  it('站上但量能未達門檻 → 突破，量能未確認', () => {
    expect(breakoutState({ bars: seq([108, 109, 115]), zone, relVolume: 1.2 }).label)
      .toBe('突破，量能未確認');
  });

  it('相對量能不可得（盤中）也只能算未確認', () => {
    expect(breakoutState({ bars: seq([108, 109, 115]), zone, relVolume: null }).state)
      .toBe('breakout_unconfirmed');
  });

  it('進入區間 → 測試壓力', () => {
    expect(breakoutState({ bars: seq([100, 105, 111]), zone, relVolume: 2 }).label).toBe('測試壓力');
  });

  it('先突破後跌回下緣 → 突破未站穩', () => {
    const r = breakoutState({ bars: seq([108, 115, 116, 113, 108]), zone, relVolume: 1 });
    expect(r.state).toBe('failed_breakout');
    expect(r.label).toBe('突破未站穩');
  });

  it('單純在壓力下方 → 無突破狀態', () => {
    expect(breakoutState({ bars: seq([100, 101, 102]), zone, relVolume: 1 }).state).toBe('below');
  });

  it('沒有壓力區時回 unknown', () => {
    expect(breakoutState({ bars: seq([100]), zone: null, relVolume: 1 }).state).toBe('unknown');
  });
});

describe('buildVolumeAnalysis', () => {
  const long = Array.from({ length: 40 }, (_, i) => ({
    date: d(i), open: 100, high: 100 + (i === 20 ? 8 : 0), low: 99, close: 100, volume: 1_000_000,
  }));

  it('組出摘要一句話，含距離與相對量能與量價狀態', () => {
    const rows = [...long];
    rows[rows.length - 1] = { ...rows[rows.length - 1], close: 105.8, high: 106, volume: 1_420_000 };
    const vm = buildVolumeAnalysis({ rawBars: rows, price: 105.8, intraday: false, displayCount: 30 });
    expect(vm.displayBars).toHaveLength(30);
    expect(vm.stats.relVolume).toBeCloseTo(1.42, 2);
    expect(vm.pv.state).toBe('up_vol_up');
    expect(vm.summary).toContain('價漲量增');
    expect(vm.summary).toMatch(/1\.42\s*倍/);
  });

  it('無成交量時仍給 K 棒與明確空狀態，不畫零量柱', () => {
    const rows = long.map((b) => ({ ...b, volume: null }));
    const vm = buildVolumeAnalysis({ rawBars: rows, price: 100, intraday: false, displayCount: 30 });
    expect(vm.displayBars.length).toBe(30);
    expect(vm.stats.hasVolume).toBe(false);
    expect(vm.emptyVolumeReason).toBe('無成交量資料');
    expect(vm.summary).not.toContain('倍');
  });

  it('盤中不得宣稱量縮', () => {
    const rows = [...long];
    rows[rows.length - 1] = { ...rows[rows.length - 1], volume: 200_000, close: 101 };
    const vm = buildVolumeAnalysis({ rawBars: rows, price: 101, intraday: true, displayCount: 30 });
    expect(vm.stats.relVolume).toBeNull();
    expect(vm.summary).not.toContain('量縮');
    expect(vm.summary).toContain('盤中');
  });

  it('日期亂序輸入仍會對齊排序後計算', () => {
    const shuffled = [...long].reverse();
    const vm = buildVolumeAnalysis({ rawBars: shuffled, price: 100, intraday: false, displayCount: 30 });
    const dates = vm.displayBars.map((b) => b.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('壓力距離文案門檻', () => {
  const mk = (closes: number[]) => closes.map((c, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    open: c, high: c * 1.002, low: c * 0.998, close: c, volume: 1_000_000,
  }));
  const withPeaks = (tail: number) => {
    const arr = Array.from({ length: 30 }, () => 90);
    arr[5] = 100; arr[15] = 100.2;
    for (let i = 20; i < 30; i += 1) arr[i] = tail;
    return arr;
  };

  it('距離 > 5% 時不得宣稱「接近」', () => {
    const va = buildVolumeAnalysis({ rawBars: mk(withPeaks(80)), price: 80 });
    expect(va.zone).not.toBeNull();
    expect(va.summary).not.toContain('接近');
    expect(va.summary).toMatch(/距離(壓力區|參考壓力)/);
  });

  it('距離 <= 5% 時維持「接近」文案', () => {
    const va = buildVolumeAnalysis({ rawBars: mk(withPeaks(96)), price: 96 });
    expect(va.zone).not.toBeNull();
    expect(va.summary).toContain('接近');
  });
});
