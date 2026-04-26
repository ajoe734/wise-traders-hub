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
}

/**
 * Navigate with retry on transient timeouts only.
 *
 * - Only `isRetryableNavigationError` errors trigger a retry; others rethrow
 *   immediately so deterministic failures fail fast.
 * - Linear backoff: `1s * attempt` between retries.
 * - When `testInfo` is provided, the per-attempt log is attached to the
 *   Playwright trace as `goto-retry-log.json` for post-mortem debugging.
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
  if (!testInfo) return;
  try {
    await testInfo.attach('goto-retry-log.json', {
      body: JSON.stringify({ url, attempts }, null, 2),
      contentType: 'application/json',
    });
  } catch {
    // Attachment is best-effort; never let trace plumbing fail a test.
  }
}

/**
 * Wait until a selector's bounding box is stable across two consecutive
 * polls. Catches the case where a card is "visible" but still shifting due
 * to font-size clamp() resolution or async sparkline mounts.
 */
export async function waitForStableBoundingBox(
  page: Page,
  selector: string,
  {
    pollIntervalMs = 100,
    stableSamples = 2,
    timeoutMs = 5_000,
    tolerancePx = 0.5,
  } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previous: { x: number; y: number; w: number; h: number } | null = null;
  let stableCount = 0;

  while (Date.now() < deadline) {
    const box = await page.locator(selector).first().boundingBox();
    if (box) {
      const current = { x: box.x, y: box.y, w: box.width, h: box.height };
      if (
        previous &&
        Math.abs(current.x - previous.x) <= tolerancePx &&
        Math.abs(current.y - previous.y) <= tolerancePx &&
        Math.abs(current.w - previous.w) <= tolerancePx &&
        Math.abs(current.h - previous.h) <= tolerancePx
      ) {
        stableCount += 1;
        if (stableCount >= stableSamples) return;
      } else {
        stableCount = 0;
      }
      previous = current;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  // Timing out here is non-fatal — caller can still proceed with snapshot.
  // eslint-disable-next-line no-console
  console.warn(
    `[waitForStableBoundingBox] selector "${selector}" did not stabilise within ${timeoutMs}ms`
  );
}
