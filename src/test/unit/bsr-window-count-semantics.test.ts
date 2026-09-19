/**
 * BSR 視窗覆蓋計數語意：分子必須夾在分母內，杜絕「27/5 個交易日」。
 * 前台鏡像 `src/checkup/lib/readinessLabel.ts` 與後端
 * `supabase/functions/_shared/seriesReadiness.ts` 必須完全一致。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readinessCountLabel,
  isWindowCovered,
  windowCoverageText,
} from '@/checkup/lib/readinessLabel';
import {
  readinessCountLabel as denoLabel,
  isWindowCovered as denoCovered,
  resolveWindow,
} from '../../../supabase/functions/_shared/seriesReadiness.ts';

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-07-${String((i % 28) + 1).padStart(2, '0')}`);

describe('readinessCountLabel', () => {
  it('have 超過 need 一律夾在 need（27/5 → 5/5）', () => {
    expect(readinessCountLabel({ have: 27, need: 5 })).toBe('5/5');
    expect(readinessCountLabel({ have: 60, need: 10 })).toBe('10/10');
  });

  it('have 小於 need 原樣顯示', () => {
    expect(readinessCountLabel({ have: 3, need: 5 })).toBe('3/5');
    expect(readinessCountLabel({ have: 0, need: 5 })).toBe('0/5');
  });

  it('負數／NaN 一律歸零，不輸出 NaN', () => {
    expect(readinessCountLabel({ have: -4, need: 5 })).toBe('0/5');
    expect(readinessCountLabel({ have: Number.NaN, need: 5 })).toBe('0/5');
    expect(readinessCountLabel({ have: 3, need: Number.NaN })).toBe('0/0');
  });

  it('isWindowCovered', () => {
    expect(isWindowCovered({ have: 27, need: 5 })).toBe(true);
    expect(isWindowCovered({ have: 5, need: 5 })).toBe(true);
    expect(isWindowCovered({ have: 4, need: 5 })).toBe(false);
    expect(isWindowCovered({ have: 3, need: 0 })).toBe(false);
  });
});

describe('windowCoverageText', () => {
  it('視窗已補滿 → 不顯示（含 have 遠大於 need 的情形）', () => {
    expect(windowCoverageText({ have: 27, need: 5 }, 5)).toBeNull();
    expect(windowCoverageText({ have: 5, need: 5 }, 5)).toBeNull();
  });

  it('補齊中 → 顯示夾住後的計數', () => {
    expect(windowCoverageText({ have: 3, need: 5 }, 5)).toBe('僅 3/5 個交易日');
    expect(windowCoverageText({ have: 7, need: 5 }, 10)).toBe('僅 7/10 個交易日');
  });

  it('無資料或 null → 不顯示', () => {
    expect(windowCoverageText(null, 5)).toBeNull();
    expect(windowCoverageText(undefined, 5)).toBeNull();
    expect(windowCoverageText({ have: 0, need: 5 }, 5)).toBeNull();
  });
});

describe('前後端規則一致', () => {
  it('readinessCountLabel / isWindowCovered 與 Deno 版輸出相同', () => {
    for (const have of [0, 1, 3, 5, 9, 27, 60]) {
      for (const need of [1, 5, 10, 20, 60]) {
        expect(readinessCountLabel({ have, need })).toBe(denoLabel({ have, need }));
        expect(isWindowCovered({ have, need })).toBe(denoCovered({ have, need }));
      }
    }
  });

  it('搭配 resolveWindow 真實 readiness：27 天序列、5 日視窗 → ready 且顯示 5/5', () => {
    const r = resolveWindow({ validDatesAsc: days(27) }, 5);
    expect(r.state).toBe('ready');
    expect(r.have).toBe(27);
    expect(readinessCountLabel({ have: r.have, need: 5 })).toBe('5/5');
    expect(windowCoverageText({ have: r.have, need: 5 }, 5)).toBeNull();
  });
});

describe('ChipsSection 不得自刻計數字串', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/checkup/components/freecheckup/ChipsSection.tsx'),
    'utf8',
  );

  it('不出現硬寫的 have/windowDays 模板或 /5 字面量', () => {
    expect(src).not.toContain('{bsrWinReadiness.have}/{bsrWinDays}');
    expect(src).not.toContain('${bsrWinReadiness.have}/${bsrWinDays}');
    expect(src).not.toContain('/5 分點');
  });

  it('計數一律走 readinessLabel 單一資料源', () => {
    expect(src).toContain("from '@/checkup/lib/readinessLabel'");
    expect(src).toContain('windowCoverageText(bsrWinReadiness, bsrWinDays)');
  });
});
