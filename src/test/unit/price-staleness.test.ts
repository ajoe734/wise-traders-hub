import { describe, it, expect } from 'vitest';
import { expectedCloseDate, stalePriceLabel } from '@/lib/priceStaleness';

// 2026/10/27 是週二
const tueNight = new Date('2026-10-27T15:00:00Z'); // 台北 23:00
const tueMorning = new Date('2026-10-27T02:00:00Z'); // 台北 10:00
const monMorning = new Date('2026-10-26T02:00:00Z'); // 台北週一 10:00

describe('持倉現價過期標示', () => {
  it('收盤後應有當日價', () => expect(expectedCloseDate(tueNight)).toBe('2026-10-27'));
  it('盤中以前一交易日為準', () => expect(expectedCloseDate(tueMorning)).toBe('2026-10-26'));
  it('週一盤中跳過週末取週五', () => expect(expectedCloseDate(monMorning)).toBe('2026-10-23'));
  it('盟立停在 10/08 必須顯示日期', () => expect(stalePriceLabel('2026-10-08', tueNight)).toBe('2026/10/08'));
  it('當日價不顯示日期', () => expect(stalePriceLabel('2026-10-27', tueNight)).toBeNull());
});
