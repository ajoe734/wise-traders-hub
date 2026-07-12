/**
 * 週界線（Asia/Taipei）邊界回歸測試
 *
 * 對應 supabase/functions/_shared/weekBoundary.ts —— 該模組同時被
 * expert-ai-training edge function 與此處 vitest 使用。任何規則變動
 * 必須同步更新兩邊，且此檔須通過。
 *
 * 覆蓋：
 *  - `taipeiMondayOf`：Taipei 週一 00:00 為分界；跨 UTC 日、跨月、跨年
 *    的訊號都要分到「正確」的 Taipei 週，不會被 UTC 判定拉到前一週。
 *  - `taipeiWeekRangeUtc`：週一 00:00+08 → UTC = 前一日 16:00Z；
 *    end = start + 7 天；`isInTaipeiWeek` 對邊界含左不含右。
 *  - 輸入防呆：格式錯誤字串。
 */
import { describe, it, expect } from 'vitest';
import {
  taipeiMondayOf,
  taipeiWeekRangeUtc,
  isInTaipeiWeek,
} from '../../../supabase/functions/_shared/weekBoundary';

const UTC = (iso: string) => new Date(iso + 'Z');

describe('taipeiMondayOf — 基本週別', () => {
  // 2026-06-08 (Mon) Taipei
  it('週一 08:00 Taipei（= UTC Mon 00:00）→ 該週一', () => {
    expect(taipeiMondayOf(UTC('2026-06-08T00:00:00'))).toBe('2026-06-08');
  });
  it('週日 23:59 Taipei（= UTC Sun 15:59）→ 前一週的週一', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T15:59:00'))).toBe('2026-06-01');
  });
  it('週日 23:59 Taipei（= UTC Sun 15:59）不會誤判為 06-08 週', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T15:59:00'))).not.toBe('2026-06-08');
  });
});

describe('taipeiMondayOf — 分界時刻（含左不含右）', () => {
  it('Taipei 週一 00:00:00 整（= UTC 前一日週日 16:00）→ 該週一', () => {
    // 2026-06-08 週一 00:00+08 = 2026-06-07 16:00Z
    expect(taipeiMondayOf(UTC('2026-06-07T16:00:00'))).toBe('2026-06-08');
  });
  it('Taipei 週一 00:00 前一秒（= UTC 15:59:59）→ 前一週', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T15:59:59'))).toBe('2026-06-01');
  });
  it('Taipei 週日 23:59:59（= UTC 15:59:59）→ 前一週', () => {
    expect(taipeiMondayOf(UTC('2026-06-14T15:59:59'))).toBe('2026-06-08');
  });
});

describe('taipeiMondayOf — UTC 判定會出錯、Taipei 判定正確的樣本', () => {
  // 樣本：Taipei 週一 06:00（=UTC 週日 22:00）。舊版 isoMonday(UTC) 會回上一週；新版應回本週一。
  it('週一凌晨 06:00 Taipei（UTC 週日 22:00）→ 該週一（本週）', () => {
    expect(taipeiMondayOf(UTC('2026-06-07T22:00:00'))).toBe('2026-06-08');
  });
  // 樣本：Taipei 週二 07:59（=UTC 週一 23:59）。UTC 判定為週一，新版必須仍為週一。
  it('週二凌晨 07:59 Taipei（UTC 週一 23:59）→ 該週一', () => {
    expect(taipeiMondayOf(UTC('2026-06-08T23:59:00'))).toBe('2026-06-08');
  });
});

describe('taipeiMondayOf — 跨月 / 跨年', () => {
  it('跨月：Taipei 2026-07-01 週三 → 週一 2026-06-29', () => {
    expect(taipeiMondayOf(UTC('2026-07-01T02:00:00'))).toBe('2026-06-29');
  });
  it('跨月：Taipei 2026-06-01 週一 00:00（UTC 05-31 16:00）→ 2026-06-01', () => {
    expect(taipeiMondayOf(UTC('2026-05-31T16:00:00'))).toBe('2026-06-01');
  });
  it('跨年：Taipei 2027-01-01 週五 09:00（UTC 01:00）→ 週一 2026-12-28', () => {
    expect(taipeiMondayOf(UTC('2027-01-01T01:00:00'))).toBe('2026-12-28');
  });
  it('跨年：Taipei 2026-01-01 週四 00:30（UTC 2025-12-31 16:30）→ 週一 2025-12-29', () => {
    expect(taipeiMondayOf(UTC('2025-12-31T16:30:00'))).toBe('2025-12-29');
  });
});

describe('taipeiWeekRangeUtc', () => {
  it('Taipei 週一 → UTC 前一日 16:00 為 start，+7 天為 end', () => {
    const { startIso, endIso } = taipeiWeekRangeUtc('2026-06-08');
    expect(startIso).toBe('2026-06-07T16:00:00.000Z');
    expect(endIso).toBe('2026-06-14T16:00:00.000Z');
  });
  it('end - start 恰為 7 天', () => {
    const { startIso, endIso } = taipeiWeekRangeUtc('2026-06-08');
    expect(new Date(endIso).getTime() - new Date(startIso).getTime())
      .toBe(7 * 86_400_000);
  });
  it('跨年週：Taipei 2025-12-29', () => {
    const { startIso, endIso } = taipeiWeekRangeUtc('2025-12-29');
    expect(startIso).toBe('2025-12-28T16:00:00.000Z');
    expect(endIso).toBe('2026-01-04T16:00:00.000Z');
  });
  it('格式錯誤字串 → throw', () => {
    expect(() => taipeiWeekRangeUtc('2026/06/08')).toThrow();
    expect(() => taipeiWeekRangeUtc('')).toThrow();
    expect(() => taipeiWeekRangeUtc('not-a-date')).toThrow();
  });
});

describe('isInTaipeiWeek — 半開區間 [週一 00:00+08, +7d)', () => {
  const wk = '2026-06-08';
  it('週一 00:00 Taipei（含）→ true', () => {
    expect(isInTaipeiWeek(UTC('2026-06-07T16:00:00'), wk)).toBe(true);
  });
  it('週一 00:00 前一毫秒 → false', () => {
    expect(isInTaipeiWeek(new Date(UTC('2026-06-07T16:00:00').getTime() - 1), wk))
      .toBe(false);
  });
  it('週日 23:59:59 Taipei → true（仍屬本週）', () => {
    expect(isInTaipeiWeek(UTC('2026-06-14T15:59:59'), wk)).toBe(true);
  });
  it('下週一 00:00 Taipei（不含）→ false', () => {
    expect(isInTaipeiWeek(UTC('2026-06-14T16:00:00'), wk)).toBe(false);
  });
  it('中段 Wed 台北時間 → true', () => {
    expect(isInTaipeiWeek(UTC('2026-06-10T05:00:00'), wk)).toBe(true);
  });
});

describe('回歸：修 UTC-week bug 前的錯誤判定', () => {
  // Bug 情境：週一凌晨 Taipei 發佈的 signal（Taipei 06-08 06:00 = UTC 06-07 22:00），
  // 舊版 isoMonday(UTC) 會回傳「2026-06-01」把它歸到上一週的訓練 session。
  // 修完後必須歸到「2026-06-08」。
  it('週一凌晨 Taipei signal 應歸到當週而非上一週', () => {
    const published = UTC('2026-06-07T22:00:00');
    expect(taipeiMondayOf(published)).toBe('2026-06-08');
    expect(isInTaipeiWeek(published, '2026-06-08')).toBe(true);
    expect(isInTaipeiWeek(published, '2026-06-01')).toBe(false);
  });
  // 另一情境：週日夜 Taipei（06-14 22:00 = UTC 14:00）仍屬 06-08 週。
  it('週日深夜 Taipei signal 不應被 UTC 邊界推入下一週', () => {
    const published = UTC('2026-06-14T14:00:00');
    expect(taipeiMondayOf(published)).toBe('2026-06-08');
    expect(isInTaipeiWeek(published, '2026-06-08')).toBe(true);
    expect(isInTaipeiWeek(published, '2026-06-15')).toBe(false);
  });
});
