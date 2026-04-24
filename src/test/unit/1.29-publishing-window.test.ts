import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPublishingWindowOpen } from '@/lib/publishingWindow';

/**
 * Helper: build a real Date that, when interpreted in Taiwan time (UTC+8),
 * lands on (year, month, day, hour, minute). We simulate the local clock by
 * setting the time to be UTC = TW - 8h.
 */
function twDate(year: number, monthIndex0: number, day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(year, monthIndex0, day, hour - 8, minute));
}

describe('1.29 publishingWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is closed on Sunday', () => {
    // 2025-04-20 is a Sunday
    vi.setSystemTime(twDate(2025, 3, 20, 10, 0));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toContain('週末');
  });

  it('is closed on Saturday', () => {
    // 2025-04-19 is a Saturday
    vi.setSystemTime(twDate(2025, 3, 19, 10, 0));
    expect(isPublishingWindowOpen().open).toBe(false);
  });

  it('is closed Monday before 08:00', () => {
    // 2025-04-21 is a Monday
    vi.setSystemTime(twDate(2025, 3, 21, 7, 59));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toContain('08:00');
  });

  it('opens at Monday 08:00 sharp', () => {
    vi.setSystemTime(twDate(2025, 3, 21, 8, 0));
    expect(isPublishingWindowOpen().open).toBe(true);
  });

  it('is open on Wednesday during business hours', () => {
    // 2025-04-23 is a Wednesday
    vi.setSystemTime(twDate(2025, 3, 23, 14, 30));
    expect(isPublishingWindowOpen().open).toBe(true);
  });

  it('is open Friday before 20:00', () => {
    // 2025-04-25 is a Friday
    vi.setSystemTime(twDate(2025, 3, 25, 19, 59));
    expect(isPublishingWindowOpen().open).toBe(true);
  });

  it('is closed Friday at 20:00', () => {
    vi.setSystemTime(twDate(2025, 3, 25, 20, 0));
    const result = isPublishingWindowOpen();
    expect(result.open).toBe(false);
    expect(result.reason).toContain('20:00');
  });
});
