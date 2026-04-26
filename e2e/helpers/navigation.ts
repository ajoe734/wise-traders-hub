import type { Page, TestInfo } from '@playwright/test';

/**
 * Errors we treat as transient and worth retrying. Anything else (e.g. a real
 * navigation error, network refusal, JS exception during init script) bubbles
 * immediately so CI doesn't burn time chasing deterministic failures.
 *
 * Detection is message-based because Playwright wraps the underlying error in
 * a generic `Error` for `goto` timeouts. The patterns below cover the cases
 * we've actually seen on the dev server:
 *   - "page.goto: Timeout 30000ms exceeded"
 *   - "Navigation timeout of 30000 ms exceeded"
 *   - "net::ERR_NETWORK_CHANGED" / "net::ERR_CONNECTION_RESET" (dev HMR restart)
 *   - "Target page, context or browser has been closed" during HMR reload
 */
const RETRYABLE_PATTERNS: RegExp[] = [
  /Timeout .* exceeded/i,
  /Navigation timeout/i,
  /net::ERR_NETWORK_CHANGED/i,
  /net::ERR_CONNECTION_RESET/i,
  /net::ERR_EMPTY_RESPONSE/i,
  /Target (page|frame), context or browser has been closed/i,
];

export function isRetryableNavigationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return RETRYABLE_PATTERNS.some((re) => re.test(err.message));
}

export interface GotoWithRetryOptions {
  maxAttempts?: number;
  perAttemptTimeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** When provided, attempt diagnostics are attached to the Playwright trace. */
  testInfo?: TestInfo;
  /** Hook so unit tests can inject a fake clock without real waits. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GotoAttemptRecord {
  attempt: number;
  durationMs: number;
  ok: boolean;
  error?: string;
  /** Branch the error message routed through. `undefined` on success. */
  classification?: 'retryable' | 'fatal';
}

/** Aggregate retry statistics for a single `gotoWithRetry` invocation. */
export interface GotoRetryStats {
  url: string;
  totalAttempts: number;
  succeeded: boolean;
  /** True when navigation succeeded but only after one or more failures. */
  recoveredAfterRetry: boolean;
  avgDurationMs: number;
  totalDurationMs: number;
  /** Map of attempt number → duration so CI can spot slow-start patterns. */
  attemptDistribution: Record<number, number>;
}

export function summarizeAttempts(
  url: string,
  attempts: GotoAttemptRecord[]
): GotoRetryStats {
  const totalAttempts = attempts.length;
  const succeeded = attempts.some((a) => a.ok);
  const totalDurationMs = attempts.reduce((sum, a) => sum + a.durationMs, 0);
  const avgDurationMs = totalAttempts ? Math.round(totalDurationMs / totalAttempts) : 0;
  const attemptDistribution: Record<number, number> = {};
  attempts.forEach((a) => {
    attemptDistribution[a.attempt] = a.durationMs;
  });
  return {
    url,
    totalAttempts,
    succeeded,
    recoveredAfterRetry: succeeded && totalAttempts > 1,
    avgDurationMs,
    totalDurationMs,
    attemptDistribution,
  };
}

/**
 * Navigate with retry on transient timeouts only.
 *
 * - Only `isRetryableNavigationError` errors trigger a retry; others rethrow
 *   immediately so deterministic failures fail fast.
 * - Linear backoff: `1s * attempt` between retries.
 * - When `testInfo` is provided, the per-attempt log AND aggregate stats are
 *   attached to the Playwright trace for post-mortem debugging.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options: GotoWithRetryOptions = {}
): Promise<GotoAttemptRecord[]> {
  const {
    maxAttempts = 3,
    perAttemptTimeout = 30_000,
    waitUntil = 'domcontentloaded',
    testInfo,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  const attempts: GotoAttemptRecord[] = [];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    try {
      await page.goto(url, { waitUntil, timeout: perAttemptTimeout });
      attempts.push({ attempt, durationMs: Date.now() - startedAt, ok: true });
      await maybeAttachLog(testInfo, url, attempts);
      return attempts;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ attempt, durationMs, ok: false, error: message });
      lastError = err;

      const retryable = isRetryableNavigationError(err);
      // eslint-disable-next-line no-console
      console.warn(
        `[gotoWithRetry] attempt ${attempt}/${maxAttempts} ${retryable ? 'transient' : 'fatal'} failure for ${url} after ${durationMs}ms: ${message}`
      );

      if (!retryable || attempt === maxAttempts) break;
      await sleep(1_000 * attempt);
    }
  }

  await maybeAttachLog(testInfo, url, attempts);
  throw lastError;
}

async function maybeAttachLog(
  testInfo: TestInfo | undefined,
  url: string,
  attempts: GotoAttemptRecord[]
) {
  const stats = summarizeAttempts(url, attempts);

  // Always surface stats to the console so CI logs show the retry profile
  // even when the trace isn't downloaded.
  // eslint-disable-next-line no-console
  console.log(
    `[gotoWithRetry][stats] ${url} attempts=${stats.totalAttempts} ok=${stats.succeeded} ` +
      `recovered=${stats.recoveredAfterRetry} avg=${stats.avgDurationMs}ms ` +
      `total=${stats.totalDurationMs}ms dist=${JSON.stringify(stats.attemptDistribution)}`
  );

  if (!testInfo) return;
  try {
    await testInfo.attach('goto-retry-log.json', {
      body: JSON.stringify({ url, attempts, stats }, null, 2),
      contentType: 'application/json',
    });
  } catch {
    // Attachment is best-effort; never let trace plumbing fail a test.
  }
}

// ---------------------------------------------------------------------------
// Geometry stability waiter
// ---------------------------------------------------------------------------

export interface BoundingBoxSample {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Max absolute delta vs previous sample (NaN for the first sample). */
  maxDelta: number;
}

export interface WaitForStableBoundingBoxOptions {
  pollIntervalMs?: number;
  /** How many CONSECUTIVE stable samples are required before returning. */
  stableSamples?: number;
  timeoutMs?: number;
  /** Per-axis tolerance in CSS pixels. */
  tolerancePx?: number;
  /** Optional TestInfo — when set, the trend log is attached to the trace. */
  testInfo?: TestInfo;
  /** Optional label for log output (defaults to the selector). */
  label?: string;
}

/**
 * Wait until a selector's bounding box is stable across N consecutive polls.
 * Catches the case where a card is "visible" but still shifting due to
 * font-size clamp() resolution or async sparkline mounts.
 *
 * Per-selector callers can tune `tolerancePx` and `stableSamples` — e.g. a
 * sparkline-heavy card may need a tighter tolerance than a static hero.
 *
 * The full sample trend is logged to the console (and attached to the trace
 * when `testInfo` is provided) so flaky stabilisations can be debugged from
 * CI output alone.
 */
export async function waitForStableBoundingBox(
  page: Page,
  selector: string,
  options: WaitForStableBoundingBoxOptions = {}
): Promise<BoundingBoxSample[]> {
  const {
    pollIntervalMs = 100,
    stableSamples = 2,
    timeoutMs = 5_000,
    tolerancePx = 0.5,
    testInfo,
    label = selector,
  } = options;

  const deadline = Date.now() + timeoutMs;
  const trend: BoundingBoxSample[] = [];
  let previous: BoundingBoxSample | null = null;
  let stableCount = 0;
  let stabilised = false;

  while (Date.now() < deadline) {
    const box = await page.locator(selector).first().boundingBox();
    if (box) {
      const sample: BoundingBoxSample = {
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        maxDelta: previous
          ? Math.max(
              Math.abs(box.x - previous.x),
              Math.abs(box.y - previous.y),
              Math.abs(box.width - previous.w),
              Math.abs(box.height - previous.h)
            )
          : Number.NaN,
      };
      trend.push(sample);

      if (previous && sample.maxDelta <= tolerancePx) {
        stableCount += 1;
        if (stableCount >= stableSamples) {
          stabilised = true;
          break;
        }
      } else {
        stableCount = 0;
      }
      previous = sample;
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[waitForStableBoundingBox] "${label}" stabilised=${stabilised} samples=${trend.length} ` +
      `tolerance=${tolerancePx}px required=${stableSamples} ` +
      `deltas=${JSON.stringify(trend.map((s) => Number.isNaN(s.maxDelta) ? null : Number(s.maxDelta.toFixed(2))))}`
  );

  if (testInfo) {
    try {
      await testInfo.attach(`bbox-trend-${sanitiseLabel(label)}.json`, {
        body: JSON.stringify({ selector, label, tolerancePx, stableSamples, stabilised, trend }, null, 2),
        contentType: 'application/json',
      });
    } catch {
      // best-effort
    }
  }

  if (!stabilised) {
    // eslint-disable-next-line no-console
    console.warn(
      `[waitForStableBoundingBox] selector "${selector}" did not stabilise within ${timeoutMs}ms`
    );
  }
  return trend;
}

function sanitiseLabel(label: string): string {
  return label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
}

// ---------------------------------------------------------------------------
// Unified navigation entrypoint
// ---------------------------------------------------------------------------

export interface HealthCheckContext {
  page: Page;
  url: string;
}

export interface NavigateAndWaitForCardReadyOptions {
  /** Selector that must become visible before declaring the page ready. */
  cardSelector: string;
  /** Max time to wait for `cardSelector` to attach to the DOM. */
  selectorTimeoutMs?: number;
  /** Forwarded to `gotoWithRetry`. */
  goto?: GotoWithRetryOptions;
  /** Forwarded to `waitForStableBoundingBox`. */
  stability?: WaitForStableBoundingBoxOptions;
  /**
   * Optional health check executed AFTER goto + selector visible, BEFORE the
   * stability waiter. Return `true` (or undefined) to proceed; return `false`
   * or throw to fail fast. Useful to assert critical API responses or DOM
   * states (e.g. portfolio loaded, no error banner) before snapshotting.
   */
  healthCheck?: (ctx: HealthCheckContext) => Promise<boolean | void>;
  testInfo?: TestInfo;
}

export interface NavigateResult {
  attempts: GotoAttemptRecord[];
  stats: GotoRetryStats;
  trend: BoundingBoxSample[];
}

/**
 * Single entry point for all e2e navigation.
 *
 * Pipeline:
 *   1. `gotoWithRetry` (transient-only retries, stats logged).
 *   2. Wait for `cardSelector` to be visible.
 *   3. Optional `healthCheck` — fail fast if the page rendered but the data
 *      we care about isn't ready (API still pending, error banner shown, …).
 *   4. `waitForStableBoundingBox` to confirm geometry has settled before any
 *      visual assertion or screenshot.
 *
 * All e2e specs MUST funnel through this helper so retry/health/stability
 * logic stays consistent across the suite.
 */
export async function navigateAndWaitForCardReady(
  page: Page,
  url: string,
  options: NavigateAndWaitForCardReadyOptions
): Promise<NavigateResult> {
  const {
    cardSelector,
    selectorTimeoutMs = 30_000,
    goto = {},
    stability = {},
    healthCheck,
    testInfo,
  } = options;

  const gotoOpts: GotoWithRetryOptions = { ...goto, testInfo: goto.testInfo ?? testInfo };
  const attempts = await gotoWithRetry(page, url, gotoOpts);
  const stats = summarizeAttempts(url, attempts);

  await page.waitForSelector(cardSelector, { state: 'visible', timeout: selectorTimeoutMs });

  if (healthCheck) {
    const ok = await healthCheck({ page, url });
    if (ok === false) {
      throw new Error(`[navigateAndWaitForCardReady] health check failed for ${url}`);
    }
  }

  const trend = await waitForStableBoundingBox(page, cardSelector, {
    ...stability,
    testInfo: stability.testInfo ?? testInfo,
  });

  return { attempts, stats, trend };
}
