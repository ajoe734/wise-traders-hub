/**
 * G-Coverage（holdings audit 2026-05）
 * 覆蓋 src/checkup/lib/holdingsSort.ts 三個對外 API：
 *   - makeCompareByPriority(decisionsMap)
 *   - holdingsValueKeyShort(holdings)
 *   - holdingsValueKeyFull(holdings)
 */
import { describe, it, expect } from 'vitest';
import {
  URGENCY_RANK,
  CONF_RANK,
  makeCompareByPriority,
  holdingsValueKeyShort,
  holdingsValueKeyFull,
} from '@/checkup/lib/holdingsSort';

describe('holdingsSort — rank constants', () => {
  it('URGENCY_RANK：now > soon > monitor', () => {
    expect(URGENCY_RANK.now).toBeGreaterThan(URGENCY_RANK.soon);
    expect(URGENCY_RANK.soon).toBeGreaterThan(URGENCY_RANK.monitor);
  });
  it('CONF_RANK：high > medium > low', () => {
    expect(CONF_RANK.high).toBeGreaterThan(CONF_RANK.medium);
    expect(CONF_RANK.medium).toBeGreaterThan(CONF_RANK.low);
  });
});

describe('makeCompareByPriority', () => {
  const dm = {
    A: { priority: 1, urgency: 'now', confidence: 'high' },
    B: { priority: 2, urgency: 'soon', confidence: 'medium' },
    C: { priority: 3, urgency: 'monitor', confidence: 'low' },
    D: { priority: 1, urgency: 'soon', confidence: 'high' },   // 與 A 同 priority
    E: { priority: 1, urgency: 'now', confidence: 'medium' },  // 與 A 同 priority+urgency
  };
  const cmp = makeCompareByPriority(dm);

  it('priority 數字越小排越前', () => {
    const sorted = [{ code: 'C' }, { code: 'A' }, { code: 'B' }].sort(cmp);
    expect(sorted.map((x) => x.code)).toEqual(['A', 'B', 'C']);
  });

  it('priority 相同時 urgency 越急排越前（now > soon > monitor）', () => {
    const sorted = [{ code: 'D' }, { code: 'A' }].sort(cmp);
    expect(sorted.map((x) => x.code)).toEqual(['A', 'D']);
  });

  it('priority + urgency 相同時 confidence 越高排越前', () => {
    const sorted = [{ code: 'E' }, { code: 'A' }].sort(cmp);
    expect(sorted.map((x) => x.code)).toEqual(['A', 'E']);
  });

  it('全部相同時 value 越大排越前', () => {
    const sorted = [
      { code: 'A', value: 100 },
      { code: 'A', value: 999 },
    ].sort(cmp);
    expect(sorted[0].value).toBe(999);
  });

  it('全部相同時 code 字典序作 tiebreaker，sort 穩定', () => {
    const sorted = [
      { code: 'Z' },
      { code: 'A' },
      { code: 'M' },
    ].sort(makeCompareByPriority({}));
    expect(sorted.map((x) => x.code)).toEqual(['A', 'M', 'Z']);
  });

  it('decisionsMap 缺項時 fallback priority=5、urgency/conf=0', () => {
    const sorted = [
      { code: 'X' },                                   // 無 decision → priority 5
      { code: 'A' },                                   // priority 1
    ].sort(cmp);
    expect(sorted.map((x) => x.code)).toEqual(['A', 'X']);
  });

  it('空 decisionsMap 不 throw', () => {
    const c = makeCompareByPriority();
    expect(() => [{ code: 'A' }, { code: 'B' }].sort(c)).not.toThrow();
  });
});

describe('holdingsValueKeyShort (FreeCheckup B-P2)', () => {
  it('空陣列 / 非陣列 → 空字串', () => {
    expect(holdingsValueKeyShort([])).toBe('');
    expect(holdingsValueKeyShort(null)).toBe('');
    expect(holdingsValueKeyShort(undefined)).toBe('');
  });

  it('值未變 → key 不變（穩定 reference 前提）', () => {
    const a = [{ code: '2330', qty: 10, price: 1000, cost: 950 }];
    const b = [{ code: '2330', qty: 10, price: 1000, cost: 950 }];
    expect(holdingsValueKeyShort(a)).toBe(holdingsValueKeyShort(b));
  });

  it('price 變動 → key 改變', () => {
    const a = [{ code: '2330', qty: 10, price: 1000, cost: 950 }];
    const b = [{ code: '2330', qty: 10, price: 1001, cost: 950 }];
    expect(holdingsValueKeyShort(a)).not.toBe(holdingsValueKeyShort(b));
  });

  it('多筆持股 → 用 ; 串接，含 length 前綴', () => {
    const k = holdingsValueKeyShort([
      { code: 'A', qty: 1, price: 10, cost: 9 },
      { code: 'B', qty: 2, price: 20, cost: 18 },
    ]);
    expect(k).toBe('n=2:A|1|10|9;B|2|20|18');
  });

  it('H13：length 前綴可區分不同長度避免碰撞', () => {
    const a = holdingsValueKeyShort([{ code: 'A', qty: 1, price: 1, cost: 1 }]);
    const b = holdingsValueKeyShort([
      { code: 'A', qty: 1, price: 1, cost: 1 },
      { code: '', qty: undefined, price: undefined, cost: undefined },
    ]);
    expect(a).not.toBe(b);
  });
});

describe('holdingsValueKeyFull (useRouteHoldingsPage D-Perf-R6)', () => {
  it('空陣列 → 空字串', () => {
    expect(holdingsValueKeyFull([])).toBe('');
    expect(holdingsValueKeyFull(null)).toBe('');
  });

  it('包含 value / pct / integrityIssue 7 個欄位 + length 前綴', () => {
    const k = holdingsValueKeyFull([
      { code: '2330', qty: 10, price: 1000, cost: 950, value: 10000, pct: 5.26, integrityIssue: '' },
    ]);
    expect(k).toBe('n=1:2330|10|1000|950|10000|5.26|');
  });

  it('integrityIssue 變化 → key 改變', () => {
    const base = { code: '2330', qty: 10, price: 1000, cost: 950, value: 10000, pct: 5.26 };
    const a = holdingsValueKeyFull([{ ...base }]);
    const b = holdingsValueKeyFull([{ ...base, integrityIssue: 'missing-price' }]);
    expect(a).not.toBe(b);
  });

  it('value 變動 → key 改變（區別於 short：short 不含 value）', () => {
    const a = [{ code: '2330', qty: 10, price: 1000, cost: 950, value: 10000, pct: 5.26 }];
    const b = [{ code: '2330', qty: 10, price: 1000, cost: 950, value: 10500, pct: 5.26 }];
    expect(holdingsValueKeyShort(a)).toBe(holdingsValueKeyShort(b));     // short 不變
    expect(holdingsValueKeyFull(a)).not.toBe(holdingsValueKeyFull(b));   // full 變
  });
});
