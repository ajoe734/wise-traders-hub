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
  reporter: process.env.CI
    ? [
        ['line'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
      ]
    : [['list']],
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
      testMatch: /freecheckup-card\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } },
    },
    {
      name: 'narrow-340',
      testMatch: /freecheckup-card\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 340, height: 700 } },
    },
    {
      name: 'iphone-12-mini-375',
      testMatch: /freecheckup-card\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'iphone-pro-max-414',
      testMatch: /freecheckup-card\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 } },
    },
    {
      name: 'desktop-batch3',
      testMatch: /batch3-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // LINE 註冊禮配額流程 — 桌面寬度即可，UI 文案+CTA 為主
      name: 'desktop-line-checkup',
      testMatch: /line-checkup-free-gift\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Checkout 成功 → toast + 自動導回 /app
      name: 'desktop-checkout-success',
      testMatch: /checkout-success-redirect\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Checkout 失敗 / 未完成 → 不導回 /app 且顯示錯誤
      name: 'desktop-checkout-failure',
      testMatch: /checkout-failure-no-redirect\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Checkout 付款逾時 → 不導回 /app、顯示「付款逾時」並提供「重試付款」
      name: 'desktop-checkout-timeout',
      testMatch: /checkout-timeout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Checkout 逾時後重試付款 → 成功 → ACTIVE
      name: 'desktop-checkout-timeout-retry',
      testMatch: /checkout-timeout-retry-success\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /app/subscriptions「失敗 / 未完成」區塊
      name: 'desktop-failed-subs-block',
      testMatch: /failed-subscriptions-block\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 重試成功後 reload → abandoned 不再誤導
      name: 'desktop-failed-subs-after-success',
      testMatch: /failed-subscriptions-after-success\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // status 過濾 + active plan 排除規則
      name: 'desktop-failed-subs-status-filter',
      testMatch: /failed-subscriptions-status-filter\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /app/expert/:slug 首次 render + 訂閱者預覽開新分頁
      name: 'desktop-app-expert-detail',
      testMatch: /app-expert-detail\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /expert/:slug bundle RPC 5xx 回退（ExpertFetchError，不可炸 ErrorBoundary）
      name: 'desktop-expert-profile-error',
      testMatch: /expert-profile-error\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /holding-checkup demo 首屏可見性（desktop 1280×800）
      name: 'desktop-demo-first-fold',
      testMatch: /freecheckup-demo-first-fold\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // F1 — 登入/註冊漏斗（auth_login_*, auth_signup_*）
      name: 'desktop-auth-funnel',
      testMatch: /auth-funnel\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // F2 — 訂閱漏斗（pricing → expert_subscribe_click → checkout_*）
      name: 'desktop-subscription-funnel',
      testMatch: /subscription-funnel\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // F3 — 訂閱取消 / 續訂
      name: 'desktop-subscription-cancel-renew',
      testMatch: /subscription-cancel-renew\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // F4 — view-as 訂閱判斷
      name: 'desktop-view-as-content-access',
      testMatch: /view-as-content-access\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // F4b — view-as 寫入守門 / 讀取改用 effectiveUserId
      name: 'desktop-view-as-parity',
      testMatch: /view-as-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Checkout 完整付款流程 + suspended expert 訊息

      name: 'desktop-checkout-full-flow',
      testMatch: /checkout-full-flow\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Route B — live smoke（真實後端 / E2E_LIVE=1 才會跑）
      name: 'desktop-live-smoke',
      testMatch: /live\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 持倉抽屜匯出選單（PNG/PDF × 1:1 / 16:9）
      name: 'desktop-holdings-export-menu',
      testMatch: /holdings-export-menu\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
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
