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

// ─────────────────────────────────────────────────────────────────────────────
// Trace attachment shape — verifies the goto-retry-log.json payload that CI
// downloads for post-mortem debugging.
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedAttachment {
  name: string;
  contentType: string;
  body: string;
}

function makeFakeTestInfo(captured: CapturedAttachment[]) {
  return {
    attach: vi.fn(async (name: string, opts: { body: string; contentType: string }) => {
      captured.push({ name, contentType: opts.contentType, body: opts.body });
    }),
    // gotoWithRetry only ever touches `attach`; cast through unknown so we
    // don't have to stub the entire TestInfo surface.
  } as unknown as Parameters<typeof gotoWithRetry>[2] extends infer O
    ? O extends { testInfo?: infer T }
      ? T
      : never
    : never;
}

describe('gotoWithRetry — goto-retry-log.json payload', () => {
  it('records attempt index, duration and classification per error branch', async () => {
    const captured: CapturedAttachment[] = [];
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('Timeout 30000ms exceeded'))   // retryable
      .mockRejectedValueOnce(new Error('net::ERR_EMPTY_RESPONSE'))    // retryable
      .mockResolvedValueOnce(undefined);                              // success
    const sleep = vi.fn().mockResolvedValue(undefined);

    await gotoWithRetry(makePage(goto), '/checkout', {
      maxAttempts: 3,
      sleep,
      testInfo: makeFakeTestInfo(captured),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe('goto-retry-log.json');
    expect(captured[0].contentType).toBe('application/json');

    const payload = JSON.parse(captured[0].body);
    expect(payload.url).toBe('/checkout');
    expect(payload.attempts).toHaveLength(3);

    // Attempt 1 → retryable timeout
    expect(payload.attempts[0]).toMatchObject({
      attempt: 1,
      ok: false,
      classification: 'retryable',
      error: expect.stringMatching(/Timeout/),
    });
    expect(typeof payload.attempts[0].durationMs).toBe('number');

    // Attempt 2 → retryable empty response
    expect(payload.attempts[1]).toMatchObject({
      attempt: 2,
      ok: false,
      classification: 'retryable',
      error: expect.stringMatching(/EMPTY_RESPONSE/),
    });

    // Attempt 3 → success has no classification / error
    expect(payload.attempts[2]).toMatchObject({ attempt: 3, ok: true });
    expect(payload.attempts[2].classification).toBeUndefined();
    expect(payload.attempts[2].error).toBeUndefined();

    expect(payload.stats).toMatchObject({
      url: '/checkout',
      totalAttempts: 3,
      succeeded: true,
      recoveredAfterRetry: true,
    });
  });

  it('classifies fatal errors correctly in the attached payload', async () => {
    const captured: CapturedAttachment[] = [];
    const goto = vi.fn().mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));

    await expect(
      gotoWithRetry(makePage(goto), '/x', {
        maxAttempts: 5,
        sleep: vi.fn(),
        testInfo: makeFakeTestInfo(captured),
      })
    ).rejects.toThrow();

    const payload = JSON.parse(captured[0].body);
    expect(payload.attempts).toHaveLength(1);
    expect(payload.attempts[0]).toMatchObject({
      attempt: 1,
      ok: false,
      classification: 'fatal',
    });
    expect(payload.stats.succeeded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight property-based fuzzing — generates 200 random messages and
// asserts classification stays deterministic for retryable-vs-fatal patterns.
// We avoid pulling in `fast-check` to keep deps lean; a seeded LCG is enough.
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE_FRAGMENTS = [
  'Timeout 30000ms exceeded',
  'Navigation timeout of 5000 ms exceeded',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_EMPTY_RESPONSE',
  'Target page, context or browser has been closed',
  'Target frame, context or browser has been closed',
];

const FATAL_FRAGMENTS = [
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CERT_AUTHORITY_INVALID',
  '500 Internal Server Error',
  'TypeError: Cannot read properties of undefined',
  'page crashed',
  'Permission denied',
];

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

const NOISE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789 :/.,()-_';
function noisify(rand: () => number, fragment: string): string {
  const prefixLen = Math.floor(rand() * 30);
  const suffixLen = Math.floor(rand() * 30);
  const make = (n: number) =>
    Array.from({ length: n }, () => NOISE_CHARS[Math.floor(rand() * NOISE_CHARS.length)]).join('');
  return `${make(prefixLen)}${fragment}${make(suffixLen)}`;
}

describe('isRetryableNavigationError — property-based fuzzing', () => {
  it('always returns true when message contains a known retryable fragment', () => {
    const rand = seededRandom(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const fragment = RETRYABLE_FRAGMENTS[i % RETRYABLE_FRAGMENTS.length];
      const message = noisify(rand, fragment);
      const result = isRetryableNavigationError(new Error(message));
      expect(result, `expected retryable for: "${message}"`).toBe(true);
    }
  });

  it('always returns false for messages that contain ONLY fatal fragments', () => {
    const rand = seededRandom(0xbadc0de);
    for (let i = 0; i < 200; i++) {
      const fragment = FATAL_FRAGMENTS[i % FATAL_FRAGMENTS.length];
      const message = noisify(rand, fragment);
      // Defence in depth: skip the rare case where noise injected a retryable
      // substring (vanishingly unlikely with our charset, but cheap to check).
      const polluted = RETRYABLE_FRAGMENTS.some((rf) => message.includes(rf));
      if (polluted) continue;
      const result = isRetryableNavigationError(new Error(message));
      expect(result, `expected fatal for: "${message}"`).toBe(false);
    }
  });

  it('classification is idempotent — same input always yields same output', () => {
    const rand = seededRandom(0xdeadbeef);
    for (let i = 0; i < 50; i++) {
      const pool = i % 2 === 0 ? RETRYABLE_FRAGMENTS : FATAL_FRAGMENTS;
      const fragment = pool[i % pool.length];
      const message = noisify(rand, fragment);
      const err = new Error(message);
      const a = isRetryableNavigationError(err);
      const b = isRetryableNavigationError(err);
      const c = isRetryableNavigationError(new Error(message));
      expect(a).toBe(b);
      expect(b).toBe(c);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Defensive classification — Error objects with missing/weird fields must
// default to non-retryable rather than throwing.
// ─────────────────────────────────────────────────────────────────────────────

describe('isRetryableNavigationError — degenerate Error shapes', () => {
  it('defaults to non-retryable when Error has no message field', () => {
    const err = new Error();
    expect(err.message).toBe('');
    expect(isRetryableNavigationError(err)).toBe(false);
  });

  it('defaults to non-retryable when message has been deleted', () => {
    const err = new Error('Timeout 30000ms exceeded');
    // @ts-expect-error — intentionally hollowing out the field
    delete err.message;
    expect(isRetryableNavigationError(err)).toBe(false);
  });

  it('still classifies correctly when stack trace is stripped', () => {
    const err = new Error('Timeout 30000ms exceeded');
    err.stack = undefined;
    // Removing the stack must not affect classification — some Playwright
    // wrappers re-throw without a stack.
    expect(isRetryableNavigationError(err)).toBe(true);
  });

  it('defaults to non-retryable for Error subclass with empty message', () => {
    class WeirdError extends Error {
      constructor() {
        super('');
        this.name = 'WeirdError';
      }
    }
    expect(isRetryableNavigationError(new WeirdError())).toBe(false);
  });

  it('defaults to non-retryable for plain object that mimics Error', () => {
    // Duck-typing must NOT be enough — we require a real Error instance to
    // avoid false positives from arbitrary thrown values.
    const fakeErr = { message: 'Timeout 30000ms exceeded', name: 'Error', stack: 'x' };
    expect(isRetryableNavigationError(fakeErr)).toBe(false);
  });

  it('defaults to non-retryable for Symbol / BigInt / function inputs', () => {
    expect(isRetryableNavigationError(Symbol('Timeout'))).toBe(false);
    expect(isRetryableNavigationError(BigInt(42))).toBe(false);
    expect(isRetryableNavigationError(() => 'Timeout')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: fatal classification short-circuits the retry loop — no
// further goto attempts AND no sleep calls after the fatal verdict.
// ─────────────────────────────────────────────────────────────────────────────

describe('gotoWithRetry — fatal short-circuit integration', () => {
  it('stops the loop immediately when the FIRST attempt is fatal', async () => {
    const fatal = new Error('net::ERR_CONNECTION_REFUSED');
    const goto = vi.fn().mockRejectedValue(fatal);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 5, sleep })
    ).rejects.toBe(fatal);

    expect(goto).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(0);
  });

  it('stops the loop immediately when a MID-sequence attempt is fatal', async () => {
    const fatal = new Error('net::ERR_CERT_AUTHORITY_INVALID');
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('Timeout 30000ms exceeded')) // retryable
      .mockRejectedValueOnce(fatal)                                   // fatal → STOP
      .mockResolvedValue(undefined);                                  // never reached
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 10, sleep })
    ).rejects.toBe(fatal);

    expect(goto).toHaveBeenCalledTimes(2);
    // Exactly one sleep — between attempt 1 and attempt 2. None after fatal.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('does not invoke sleep after the LAST retryable attempt', async () => {
    const goto = vi.fn().mockRejectedValue(new Error('Timeout exceeded'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', { maxAttempts: 3, sleep })
    ).rejects.toThrow(/Timeout/);

    expect(goto).toHaveBeenCalledTimes(3);
    // Only sleeps BETWEEN attempts: between 1↔2 and 2↔3 → 2 sleeps total.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('records exactly N attempts in the trace log when fatal short-circuits at N', async () => {
    const captured: CapturedAttachment[] = [];
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('Timeout exceeded'))
      .mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      gotoWithRetry(makePage(goto), '/x', {
        maxAttempts: 10,
        sleep,
        testInfo: makeFakeTestInfo(captured),
      })
    ).rejects.toThrow();

    const payload = JSON.parse(captured[0].body);
    // 2 attempts logged, NOT 10 — fatal classification stopped the loop.
    expect(payload.attempts).toHaveLength(2);
    expect(payload.attempts.map((a: GotoAttemptRecordLike) => a.classification)).toEqual([
      'retryable',
      'fatal',
    ]);
  });
});

// Local mirror of the public type to avoid importing implementation details
// the test doesn't otherwise need.
interface GotoAttemptRecordLike {
  classification?: 'retryable' | 'fatal';
}
