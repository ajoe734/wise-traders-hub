import { describe, it, expect } from 'vitest';
import {
  resolveProjectionStatus,
  projectedNumber,
  projectedPercent,
  projectedAmount,
  canExportFactsheet,
  REVIEW_BADGE,
  REVIEW_NOTE,
} from './publicProjection';

describe('publicProjection contract', () => {
  it('ready shows numbers and no notice', () => {
    const s = resolveProjectionStatus({ state: 'ready' });
    expect(s.state).toBe('ready');
    expect(s.showNumbers).toBe(true);
    expect(s.showReviewNotice).toBe(false);
    expect(projectedPercent(s, 12.345)).toBe('+12.35%');
    expect(projectedAmount(s, 1234567.4)).toBe('$1,234,567');
    expect(canExportFactsheet(s)).toBe(true);
  });

  it.each([
    ['manual_review', { manualReview: true }],
    ['incomplete', { incomplete: true }],
    ['withheld', { withheld: true }],
  ] as const)('%s hides every number and shows the review copy', (expected, input) => {
    const s = resolveProjectionStatus(input);
    expect(s.state).toBe(expected);
    expect(s.showNumbers).toBe(false);
    expect(s.badge).toBe(REVIEW_BADGE);
    expect(s.note).toBe(REVIEW_NOTE);
    // 6515: neither candidate may ever be rendered
    expect(projectedNumber(s, 10)).toBeNull();
    expect(projectedNumber(s, 50)).toBeNull();
    expect(projectedNumber(s, 0)).toBeNull();
    expect(projectedPercent(s, 0)).toBeNull();
    expect(projectedAmount(s, 0)).toBeNull();
    expect(canExportFactsheet(s)).toBe(false);
  });

  it('an unknown state fails closed to incomplete', () => {
    const s = resolveProjectionStatus({ state: 'something_new' });
    expect(s.state).toBe('incomplete');
    expect(s.showNumbers).toBe(false);
  });

  it('a missing projection fails closed (no legacy numeric path)', () => {
    const s = resolveProjectionStatus({ absent: true });
    expect(s.state).toBe('incomplete');
    expect(s.showNumbers).toBe(false);
    expect(s.showReviewNotice).toBe(true);
    expect(canExportFactsheet(s)).toBe(false);
  });

  it('a failed read never blanks and never fakes', () => {
    const s = resolveProjectionStatus({ failed: true });
    expect(s.state).toBe('error');
    expect(projectedNumber(s, Number.NaN)).toBeNull();
    expect(projectedPercent(s, Number.NaN)).toBeNull();
    expect(projectedPercent(s, undefined)).toBeNull();
  });

  it('never leaks an internal reason code or hashed key', () => {
    const s = resolveProjectionStatus({
      state: 'manual_review',
      // deliberately dirty input
      ...({ reason: 'multiple_apply', key: 'K-9f0a1b' } as any),
    });
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain('multiple_apply');
    expect(serialised).not.toContain('K-9f0a1b');
    expect(s.badge).toBe(REVIEW_BADGE);
  });

  it('NaN and non-finite input can never render', () => {
    const ready = resolveProjectionStatus({ state: 'ready' });
    expect(projectedNumber(ready, Number.NaN)).toBeNull();
    expect(projectedNumber(ready, Number.POSITIVE_INFINITY)).toBeNull();
    expect(projectedPercent(ready, Number.NaN)).toBeNull();
  });
});
