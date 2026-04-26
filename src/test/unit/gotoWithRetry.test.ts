import { describe, it, expect, vi } from 'vitest';
import {
  gotoWithRetry,
  isRetryableNavigationError,
  summarizeAttempts,
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
  // ── Retryable: Playwright-wrapped timeouts ───────────────────────────────
  it.each([
    ['lowercase Playwright goto timeout', 'page.goto: Timeout 30000ms exceeded.'],
    ['capitalised Navigation timeout', 'Navigation timeout of 30000 ms exceeded'],
    ['custom timeout copy', 'Timeout 5000ms exceeded while waiting for selector'],
    ['mixed case timeout', 'TIMEOUT 1000ms EXCEEDED'],
  ])('treats "%s" as retryable', (_label, message) => {
    expect(isRetryableNavigationError(new Error(message))).toBe(true);
  });

  // ── Retryable: dev-server / HMR transient network drops ──────────────────
  it.each([
    ['connection reset (HMR restart)', 'net::ERR_CONNECTION_RESET at http://localhost:5173'],
    ['network changed mid-flight', 'page.goto: net::ERR_NETWORK_CHANGED'],
    ['empty response from Vite', 'net::ERR_EMPTY_RESPONSE'],
    ['target page closed during reload', 'Target page, context or browser has been closed'],
    ['target frame closed during reload', 'Target frame, context or browser has been closed'],
  ])('treats "%s" as retryable', (_label, message) => {
    expect(isRetryableNavigationError(new Error(message))).toBe(true);
  });

  // ── Fatal: deterministic failures must fail fast ─────────────────────────
  it.each([
    ['DNS resolution failure', 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.local'],
    ['connection refused', 'net::ERR_CONNECTION_REFUSED at http://localhost:9999'],
    ['SSL cert error', 'net::ERR_CERT_AUTHORITY_INVALID'],
    ['HTTP 500 from server', 'page.goto: 500 Internal Server Error'],
    ['arbitrary JS exception', 'TypeError: Cannot read properties of undefined'],
    ['empty error message', ''],
  ])('treats "%s" as fatal (not retryable)', (_label, message) => {
    expect(isRetryableNavigationError(new Error(message))).toBe(false);
  });

  // ── Non-Error inputs are never retryable ─────────────────────────────────
  it.each([
    ['plain string', 'string error'],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['plain object with message-like field', { message: 'Timeout exceeded' }],
  ])('rejects non-Error input "%s"', (_label, input) => {
    expect(isRetryableNavigationError(input)).toBe(false);
  });
});

describe('gotoWithRetry — branch routing per error message', () => {
  it('retries on net::ERR_EMPTY_RESPONSE then succeeds', async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('net::ERR_EMPTY_RESPONSE'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const attempts = await gotoWithRetry(makePage(goto), '/x', {
      maxAttempts: 3,
      sleep,
    });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1_000);
    expect(attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it('retries on "Target page closed" then succeeds', async () => {
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('Target page, context or browser has been closed'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const attempts = await gotoWithRetry(makePage(goto), '/x', { sleep });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(attempts[0].error).toMatch(/Target page/);
    expect(attempts[1].ok).toBe(true);
  });

  it('fails fast on net::ERR_CONNECTION_REFUSED without retrying', async () => {
    const fatal = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:9999');
    const goto = vi.fn().mockRejectedValue(fatal);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 5, sleep })
    ).rejects.toBe(fatal);

    expect(goto).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails fast on net::ERR_CERT_AUTHORITY_INVALID without retrying', async () => {
    const fatal = new Error('net::ERR_CERT_AUTHORITY_INVALID');
    const goto = vi.fn().mockRejectedValue(fatal);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 5, sleep })
    ).rejects.toBe(fatal);

    expect(goto).toHaveBeenCalledTimes(1);
  });

  it('switches from retryable to fatal mid-sequence and stops immediately', async () => {
    const fatal = new Error('net::ERR_NAME_NOT_RESOLVED at https://nope.local');
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('Timeout 30000ms exceeded'))
      .mockRejectedValueOnce(fatal) // fatal on attempt 2 → must NOT proceed to attempt 3
      .mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 5, sleep })
    ).rejects.toBe(fatal);

    expect(goto).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1_000);
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

describe('summarizeAttempts', () => {
  it('reports first-try success without recovery flag', () => {
    const stats = summarizeAttempts('/x', [
      { attempt: 1, durationMs: 120, ok: true },
    ]);
    expect(stats).toMatchObject({
      url: '/x',
      totalAttempts: 1,
      succeeded: true,
      recoveredAfterRetry: false,
      avgDurationMs: 120,
      totalDurationMs: 120,
      attemptDistribution: { 1: 120 },
    });
  });

  it('flags recoveredAfterRetry when a retry rescues a failed attempt', () => {
    const stats = summarizeAttempts('/x', [
      { attempt: 1, durationMs: 30_000, ok: false, error: 'Timeout' },
      { attempt: 2, durationMs: 800, ok: true },
    ]);
    expect(stats.succeeded).toBe(true);
    expect(stats.recoveredAfterRetry).toBe(true);
    expect(stats.totalAttempts).toBe(2);
    expect(stats.avgDurationMs).toBe(15_400);
    expect(stats.attemptDistribution).toEqual({ 1: 30_000, 2: 800 });
  });

  it('reports failure stats when every attempt fails', () => {
    const stats = summarizeAttempts('/x', [
      { attempt: 1, durationMs: 1000, ok: false },
      { attempt: 2, durationMs: 1000, ok: false },
    ]);
    expect(stats.succeeded).toBe(false);
    expect(stats.recoveredAfterRetry).toBe(false);
  });
});
