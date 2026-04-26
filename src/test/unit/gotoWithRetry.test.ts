import { describe, it, expect, vi } from 'vitest';
import {
  gotoWithRetry,
  isRetryableNavigationError,
} from '../../../e2e/helpers/navigation';

/**
 * Lightweight Page mock — only the surface gotoWithRetry actually touches.
 * We deliberately avoid importing @playwright/test here because the helper
 * doesn't depend on its runtime, only on the structural Page.goto signature.
 */
function makePage(gotoImpl: ReturnType<typeof vi.fn>) {
  return { goto: gotoImpl } as unknown as Parameters<typeof gotoWithRetry>[0];
}

const TIMEOUT_ERR = () =>
  new Error('page.goto: Timeout 30000ms exceeded.');
const FATAL_ERR = () =>
  new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.local');

describe('isRetryableNavigationError', () => {
  it('classifies Playwright timeouts as retryable', () => {
    expect(isRetryableNavigationError(TIMEOUT_ERR())).toBe(true);
    expect(isRetryableNavigationError(new Error('Navigation timeout of 30000 ms exceeded'))).toBe(true);
  });

  it('classifies HMR-restart-style network drops as retryable', () => {
    expect(isRetryableNavigationError(new Error('net::ERR_CONNECTION_RESET'))).toBe(true);
    expect(
      isRetryableNavigationError(
        new Error('Target page, context or browser has been closed')
      )
    ).toBe(true);
  });

  it('does NOT retry deterministic errors (e.g. DNS)', () => {
    expect(isRetryableNavigationError(FATAL_ERR())).toBe(false);
    expect(isRetryableNavigationError(new Error('boom'))).toBe(false);
    expect(isRetryableNavigationError('string error')).toBe(false);
  });
});

describe('gotoWithRetry', () => {
  it('returns immediately on first-attempt success', async () => {
    const goto = vi.fn().mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const attempts = await gotoWithRetry(makePage(goto), '/x', { sleep });

    expect(goto).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].ok).toBe(true);
  });

  it('retries on transient timeout and eventually succeeds', async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(TIMEOUT_ERR())
      .mockRejectedValueOnce(TIMEOUT_ERR())
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const attempts = await gotoWithRetry(makePage(goto), '/x', {
      maxAttempts: 3,
      sleep,
    });

    expect(goto).toHaveBeenCalledTimes(3);
    // Linear backoff: 1s after attempt 1, 2s after attempt 2.
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000);
    expect(attempts.map((a) => a.ok)).toEqual([false, false, true]);
  });

  it('throws the last error after exhausting maxAttempts', async () => {
    const err = TIMEOUT_ERR();
    const goto = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 3, sleep })
    ).rejects.toBe(err);

    expect(goto).toHaveBeenCalledTimes(3);
    // Sleep happens between attempts only — never after the final attempt.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on fatal (non-transient) errors', async () => {
    const fatal = FATAL_ERR();
    const goto = vi.fn().mockRejectedValueOnce(fatal);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 5, sleep })
    ).rejects.toBe(fatal);

    expect(goto).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('forwards perAttemptTimeout and waitUntil to page.goto', async () => {
    const goto = vi.fn().mockResolvedValueOnce(undefined);
    await gotoWithRetry(makePage(goto), '/x', {
      perAttemptTimeout: 12_345,
      waitUntil: 'load',
      sleep: vi.fn(),
    });

    expect(goto).toHaveBeenCalledWith('/x', {
      waitUntil: 'load',
      timeout: 12_345,
    });
  });
});
