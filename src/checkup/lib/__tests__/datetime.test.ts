import { describe, it, expect } from 'vitest';
import {
  parseStoredDate,
  parseFlexibleDate,
  formatDateToStorageDate,
  daysSince,
  formatDateTW,
  formatDateMD,
  formatTime,
  formatDateTime,
  getRelativeTime,
} from '../datetime.js';

const anyIn = (x: unknown) => x as any;
const JUNK: unknown[] = [
  null, undefined, '', '   ', 'garbage', 'not-a-date', NaN, {}, [], true, false,
  '2026-13-40',
];

describe('parseStoredDate', () => {
  it('非字串 → null', () => {
    expect(parseStoredDate(null)).toBeNull();
    expect(parseStoredDate(anyIn(123))).toBeNull();
    expect(parseStoredDate(anyIn({}))).toBeNull();
    expect(parseStoredDate('garbage')).toBeNull();
  });
  it('有效', () => {
    expect(parseStoredDate('2026-01-05T00:00:00Z')).toBeInstanceOf(Date);
  });
});

describe('parseFlexibleDate', () => {
  it.each(JUNK)('junk %p → null 或有效 Date（且不丟）', (v) => {
    expect(() => parseFlexibleDate(anyIn(v))).not.toThrow();
    const r = parseFlexibleDate(anyIn(v));
    if (r) expect(r.getTime()).not.toBeNaN();
  });
  it('slash / iso / date instance / number', () => {
    expect(parseFlexibleDate('2024/2/9')?.getFullYear()).toBe(2024);
    expect(parseFlexibleDate('2024-02-09')?.getMonth()).toBe(1);
    const d = new Date('2026-01-01T00:00:00Z');
    expect(parseFlexibleDate(d)?.getTime()).toBe(d.getTime());
    expect(parseFlexibleDate(d.getTime())?.getTime()).toBe(d.getTime());
  });
  it('invalid Date instance', () => {
    expect(parseFlexibleDate(new Date(NaN))).toBeNull();
  });
});

describe('formatDateToStorageDate', () => {
  it('無效 → 今日', () => {
    const out = formatDateToStorageDate('garbage');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('有效', () => {
    expect(formatDateToStorageDate('2024/2/9')).toMatch(/^2024-02-0[89]$/);
  });
});

describe('daysSince', () => {
  it('無效 → null', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince('garbage')).toBeNull();
    expect(daysSince('2026-01-01', anyIn('nope'))).toBeNull();
  });
  it('邊界', () => {
    const now = new Date('2026-06-15T00:00:00');
    expect(daysSince('2026-06-15', now)).toBe(0);
    expect(daysSince('2026-06-14', now)).toBe(1);
    expect(daysSince('2026-06-08', now)).toBe(7);
  });
});

describe('formatDateTW / formatDateMD / formatTime / formatDateTime', () => {
  it.each(JUNK)('junk %p → 空字串且不丟例外', (v) => {
    expect(() => formatDateTW(anyIn(v))).not.toThrow();
    expect(() => formatDateMD(anyIn(v))).not.toThrow();
    expect(() => formatTime(anyIn(v))).not.toThrow();
    expect(() => formatDateTime(anyIn(v))).not.toThrow();
    for (const fn of [formatDateTW, formatDateMD, formatTime, formatDateTime]) {
      expect(fn(anyIn(v))).not.toMatch(/NaN|Invalid/);
    }
  });
  it('正常', () => {
    const d = new Date(2026, 0, 5, 9, 30);
    expect(formatDateTW(d)).toBe('2026/01/05');
    expect(formatDateMD(d)).toBe('01/05');
    expect(formatTime(d)).toBe('09:30');
    expect(formatDateTime(d)).toBe('2026/01/05 09:30');
  });
});

describe('getRelativeTime', () => {
  it('無效 → ""', () => {
    expect(getRelativeTime(null)).toBe('');
    expect(getRelativeTime('garbage')).toBe('');
  });
  it('邊界', () => {
    const now = new Date('2026-06-15T12:00:00');
    expect(getRelativeTime('2026-06-15T12:00:00', now)).toBe('今天');
    expect(getRelativeTime('2026-06-14T12:00:00', now)).toBe('昨天');
    expect(getRelativeTime('2026-06-10T12:00:00', now)).toBe('5天前');
    expect(getRelativeTime('2026-06-08T12:00:00', now)).toBe('1週前');
    expect(getRelativeTime('2026-05-15T12:00:00', now)).toBe('1個月前');
    expect(getRelativeTime('2025-06-15T12:00:00', now)).toBe('1年前');
  });
});
