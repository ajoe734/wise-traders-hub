// TDD seam 1：K 棒 tooltip 的純函式（原本寫死在 HoldingsDetailPanel 的 RangeBand 內）
// 行為規格：滑鼠/觸控 X → 最近一根 K 棒索引 → 十字線位置 → tooltip 翻轉方向 + 文字格式。
import { describe, it, expect } from 'vitest';
import {
  barIndexFromX,
  barCenterPct,
  shouldFlipTooltip,
  fmtKlineDate,
  fmtKlineNum,
} from '../klineTooltip';

describe('barIndexFromX', () => {
  const rect = { left: 100, width: 200 };

  it('落在左緣回傳第一根', () => {
    expect(barIndexFromX(100, rect, 5)).toBe(0);
  });

  it('落在右緣回傳最後一根', () => {
    expect(barIndexFromX(300, rect, 5)).toBe(4);
  });

  it('取最近的一根（四捨五入，非無條件捨去）', () => {
    // 5 根 → 間距 50px；x=180 距離 index 1(150) 30px、index 2(200) 20px → 取 2
    expect(barIndexFromX(180, rect, 5)).toBe(2);
  });

  it('超出左右邊界會被夾住', () => {
    expect(barIndexFromX(-999, rect, 5)).toBe(0);
    expect(barIndexFromX(9999, rect, 5)).toBe(4);
  });

  it('寬度為 0 或根數不足時回傳 null（不可產生 NaN 索引）', () => {
    expect(barIndexFromX(150, { left: 100, width: 0 }, 5)).toBeNull();
    expect(barIndexFromX(150, rect, 0)).toBeNull();
    expect(barIndexFromX(150, rect, 1)).toBe(0);
  });
});

describe('barCenterPct', () => {
  it('索引換算成 0-100 百分比', () => {
    expect(barCenterPct(0, 5)).toBe(0);
    expect(barCenterPct(2, 5)).toBe(50);
    expect(barCenterPct(4, 5)).toBe(100);
  });

  it('索引為 null 或根數 < 2 時回傳 null', () => {
    expect(barCenterPct(null, 5)).toBeNull();
    expect(barCenterPct(0, 1)).toBeNull();
  });
});

describe('shouldFlipTooltip', () => {
  it('超過 60% 往左翻，避免超出右緣', () => {
    expect(shouldFlipTooltip(61)).toBe(true);
    expect(shouldFlipTooltip(60)).toBe(false);
    expect(shouldFlipTooltip(0)).toBe(false);
    expect(shouldFlipTooltip(null)).toBe(false);
  });
});

describe('fmtKlineDate', () => {
  it('ISO 日期輸出 YYYY/MM/DD（專案日期憲法）', () => {
    expect(fmtKlineDate('2026-07-31')).toBe('2026/07/31');
    expect(fmtKlineDate('2026-07-31T00:00:00Z')).toBe('2026/07/31');
  });

  it('非 ISO 字串把破折號換成斜線', () => {
    expect(fmtKlineDate('2026-7-3')).toBe('2026/7/3');
  });

  it('空值顯示破折號', () => {
    expect(fmtKlineDate(null)).toBe('—');
    expect(fmtKlineDate('')).toBe('—');
  });
});

describe('fmtKlineNum', () => {
  it('數字固定兩位小數', () => {
    expect(fmtKlineNum(12)).toBe('12.00');
    expect(fmtKlineNum(12.345)).toBe('12.35');
  });

  it('非有限數顯示破折號', () => {
    expect(fmtKlineNum(null)).toBe('—');
    expect(fmtKlineNum(NaN)).toBe('—');
    expect(fmtKlineNum('abc' as unknown as number)).toBe('—');
  });
});
