import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPublishingWindowOpen, marketOfAssetClass, nextPublishMomentLabel } from '@/lib/publishingWindow';

function twDate(year: number, monthIndex0: number, day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(year, monthIndex0, day, hour - 8, minute));
}

describe('1.29 publishingWindow (TW default)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('closed on Sunday', () => {
    vi.setSystemTime(twDate(2025, 3, 20, 10, 0));
    expect(isPublishingWindowOpen().open).toBe(false);
  });
  it('closed on Saturday', () => {
    vi.setSystemTime(twDate(2025, 3, 19, 10, 0));
    expect(isPublishingWindowOpen().open).toBe(false);
  });
  it('closed Monday before 08:00', () => {
    vi.setSystemTime(twDate(2025, 3, 21, 7, 59));
    expect(isPublishingWindowOpen().open).toBe(false);
  });
  it('opens Monday 08:00', () => {
    vi.setSystemTime(twDate(2025, 3, 21, 8, 0));
    expect(isPublishingWindowOpen().open).toBe(true);
  });
  it('open Friday 19:59', () => {
    vi.setSystemTime(twDate(2025, 3, 25, 19, 59));
    expect(isPublishingWindowOpen('tw_stock').open).toBe(true);
  });
  it('closed Friday 20:00', () => {
    vi.setSystemTime(twDate(2025, 3, 25, 20, 0));
    expect(isPublishingWindowOpen('tw_stock').open).toBe(false);
  });
});

describe('1.29 publishingWindow (US market)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('US open Friday 20:00 (TW rule does not apply)', () => {
    vi.setSystemTime(twDate(2025, 3, 25, 20, 0));
    expect(isPublishingWindowOpen('us_stock').open).toBe(true);
  });
  it('US open Friday 23:30', () => {
    vi.setSystemTime(twDate(2025, 3, 25, 23, 30));
    expect(isPublishingWindowOpen('us_futures').open).toBe(true);
  });
  it('US open Saturday 07:59', () => {
    vi.setSystemTime(twDate(2025, 3, 26, 7, 59));
    expect(isPublishingWindowOpen('us_stock').open).toBe(true);
  });
  it('US closed Saturday 08:00', () => {
    vi.setSystemTime(twDate(2025, 3, 26, 8, 0));
    const r = isPublishingWindowOpen('us_stock');
    expect(r.open).toBe(false);
    expect(r.reason).toContain('08:00');
  });
  it('US closed Sunday all day', () => {
    vi.setSystemTime(twDate(2025, 3, 27, 12, 0));
    expect(isPublishingWindowOpen('crypto').open).toBe(false);
  });
  it('US closed Monday 07:59', () => {
    vi.setSystemTime(twDate(2025, 3, 28, 7, 59));
    expect(isPublishingWindowOpen('us_stock').open).toBe(false);
  });
});

describe('1.29 helpers', () => {
  it('classifies markets', () => {
    expect(marketOfAssetClass('us_stock')).toBe('US');
    expect(marketOfAssetClass('us_futures')).toBe('US');
    expect(marketOfAssetClass('crypto')).toBe('US');
    expect(marketOfAssetClass('tw_stock')).toBe('TW');
    expect(marketOfAssetClass(null)).toBe('TW');
    expect(marketOfAssetClass(undefined)).toBe('TW');
  });
  it('next moment label', () => {
    expect(nextPublishMomentLabel('us_stock')).toContain('週六');
    expect(nextPublishMomentLabel('tw_stock')).toContain('週五');
    expect(nextPublishMomentLabel()).toContain('週五');
  });
});
