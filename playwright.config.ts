import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const NIX_CHROMIUM =
  '/nix/store/nw961dvpvik5m19kbay4cg27wxgl3sdv-playwright-chromium-headless-shell/chrome-linux/headless_shell';
const RESOLVED_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  (existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined);


/**
 * Playwright config — Mobile visual regression for /free-checkup
 *
 * 4 viewports (320 / 340 / 375 / 414) x screenshot baselines stored under
 * `e2e/freecheckup-card.spec.ts-snapshots/`.
 *
 * The spec also runs `boundingClientRect` overflow assertions so a true
 * regression is caught even if pixel diff is masked by anti-aliasing.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : [['list']],
  timeout: 60_000,
  expect: {
    // Strict pixel diff for layout regressions; tolerate sub-pixel AA.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    deviceScaleFactor: 2,
    launchOptions: RESOLVED_CHROMIUM
      ? { executablePath: RESOLVED_CHROMIUM }
      : undefined,
  },
  projects: [
    {
      name: 'iphone-se-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } },
    },
    {
      name: 'narrow-340',
      use: { ...devices['Desktop Chrome'], viewport: { width: 340, height: 700 } },
    },
    {
      name: 'iphone-12-mini-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'iphone-pro-max-414',
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 } },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
