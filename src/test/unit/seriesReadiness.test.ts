import { describe, it, expect } from 'vitest';
import {
  resolveWindow,
  resolveAllWindows,
  readinessCopy,
} from '../../../supabase/functions/_shared/seriesReadiness.ts';

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

describe('seriesReadiness', () => {
  it('ready when have >= window', () => {
    const r = resolveWindow({ validDatesAsc: days(5) }, 5);
    expect(r.state).toBe('ready');
    expect(r.have).toBe(5);
  });

  it('filling when have < window and upstream not exhausted', () => {
    const r = resolveWindow({ validDatesAsc: days(3) }, 5);
    expect(r.state).toBe('filling');
    expect(r.have).toBe(3);
  });

  it('upstream_exhausted when have < window and exhausted', () => {
    const r = resolveWindow(
      { validDatesAsc: days(3), upstreamExhausted: true },
      60,
    );
    expect(r.state).toBe('upstream_exhausted');
    expect(r.oldest_available).toBe('2026-07-01');
  });

  it('no_data when empty and not exhausted', () => {
    const r = resolveWindow({ validDatesAsc: [] }, 5);
    expect(r.state).toBe('no_data');
    expect(r.have).toBe(0);
  });

  it('resolveAllWindows returns 5/20/60 with correct states', () => {
    const all = resolveAllWindows({ validDatesAsc: days(10) });
    expect(all['5'].state).toBe('ready');
    expect(all['20'].state).toBe('filling');
    expect(all['60'].state).toBe('filling');
  });

  it('resolveAllWindows 含 1／10 日視窗（關鍵分點切換用）', () => {
    const all = resolveAllWindows({ validDatesAsc: days(7) });
    expect(Object.keys(all).sort()).toEqual(['1', '10', '20', '5', '60']);
    expect(all['1'].state).toBe('ready');
    expect(all['5'].state).toBe('ready');
    expect(all['10'].state).toBe('filling');
    expect(all['10'].have).toBe(7);
    expect(all['10'].need).toBe(10);
  });

  it('1 日視窗：無資料為 no_data，一天即 ready', () => {
    expect(resolveWindow({ validDatesAsc: [] }, 1).state).toBe('no_data');
    expect(resolveWindow({ validDatesAsc: days(1) }, 1).state).toBe('ready');
  });

  it('copy: ready 無文案，filling 顯示進度，exhausted 顯示最早日期', () => {
    expect(readinessCopy(resolveWindow({ validDatesAsc: days(5) }, 5))).toBe('');
    expect(readinessCopy(resolveWindow({ validDatesAsc: days(2) }, 5))).toContain('2/5');
    expect(
      readinessCopy(
        resolveWindow({ validDatesAsc: days(2), upstreamExhausted: true }, 60),
      ),
    ).toContain('2026/07/01');
  });

  it('絕不吐出「至少需要 N 個交易日」字樣', () => {
    for (const w of [1, 5, 10, 20, 60] as const) {
      for (const have of [0, 1, 4, 5, 10, 20, 60]) {
        for (const exh of [false, true]) {
          const r = resolveWindow(
            { validDatesAsc: days(have), upstreamExhausted: exh },
            w,
          );
          expect(readinessCopy(r)).not.toMatch(/至少需要.*個交易日/);
        }
      }
    }
  });
});
