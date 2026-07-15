import type { Page } from '@playwright/test';

export type HarnessFixture = {
  h?: Record<string, any>;
  meta?: Record<string, any> | null;
  dec?: Record<string, any> | null;
  tp?: number | null;
  upside?: number | null;
  hasToday?: boolean;
  todayPnlNum?: number | null;
  todayPctNum?: number | null;
  variant?: 'normal' | 'ink';
};

export function encodeFixture(fx: HarnessFixture): string {
  const json = JSON.stringify(fx);
  // utf-8 safe base64url
  const b64 = Buffer.from(unescape(encodeURIComponent(json)), 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function gotoHarness(page: Page, fx: HarnessFixture) {
  const enc = encodeFixture(fx);
  await page.goto(`/e2e/holding-card-harness?d=${enc}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#harness-root .wb-bottom', { timeout: 10_000 });
}
