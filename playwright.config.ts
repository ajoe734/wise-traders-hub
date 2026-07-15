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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI 適度重試以吸收偶發 flake；本地不重試以便快速看到真實錯誤
  retries: process.env.CI ? 2 : 0,
  // CI 開啟並行 workers（每個 project 內 / 跨檔案）；本地維持序列避免互相干擾
  workers: process.env.CI ? 4 : 1,
  reporter: process.env.CI
    ? [
        ['line'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
        ['blob', { outputDir: 'blob-report' }],
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
    // 失敗時自動收集 trace.zip / 截圖 / 影片，並在第一次重試也收集
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
      // HoldingCard 鍵盤/ARIA 回歸 — memoization 後行為對等驗證（iPhone 390 寬）
      name: 'iphone-390-a11y',
      testMatch: /freecheckup-card-a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      // Sparkline pctSign → stroke/opacity 視覺一致性回歸（跨零時輸出必變）
      name: 'iphone-390-sparkline',
      testMatch: /freecheckup-sparkline-signs\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
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
      // /app/expert/:slug 「問老師 AI」分頁存取權限（admin / 未訂閱 / 已訂閱）
      name: 'desktop-expert-ai-chat-access',
      testMatch: /expert-ai-chat-access\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /app/journal/:id 標題完整顯示 + 顯示全部/收合折疊行為
      name: 'desktop-journal-detail-title-collapse',
      testMatch: /journal-detail-title-collapse\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /expert/:slug bundle RPC 5xx 回退（ExpertFetchError，不可炸 ErrorBoundary）
      name: 'desktop-expert-profile-error',
      testMatch: /expert-profile-error\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /company/account-merges 排序 URL 同步 + CSV 匯出 loading/中止/重試/錯誤
      name: 'desktop-account-merges-sort-export',
      testMatch: /account-merges-sort-export\.spec\.ts/,
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
    {
      // 窄螢幕 863px：點卡片必須展開新版 HoldingsDetailPanel（不是 legacy overlay）
      name: 'narrow-holdings-detail-panel',
      testMatch: /holdings-detail-panel-narrow\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 863, height: 900 } },
    },
    {
      // 寬螢幕 1280px：HoldingsDetailPanel + ComparisonCharts + ExportMenu；legacy overlay 不出現
      name: 'desktop-holdings-detail-panel',
      testMatch: /holdings-detail-panel-wide\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // overridePrice 換價後 HoldingCard 必須重算 todayPnl / todayPct / 保留 yesterday
      name: 'desktop-holdings-override-price',
      testMatch: /holdings-override-price-recompute\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // overridePrice 換價：market-open / market-closed 兩情境 + 多卡片同步 + 錯誤/重試 UI
      name: 'desktop-holdings-override-price-scenarios',
      testMatch: /holdings-override-price-scenarios\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // overridePrice 換價：debounce 快速觸發 + 部分卡片失敗 + 局部 loading
      name: 'desktop-holdings-override-price-debounce',
      testMatch: /holdings-override-price-debounce\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // HoldingCard aria-live 螢幕閱讀器狀態（同步中 / 完成 / 錯誤三態）
      name: 'desktop-holdings-aria-live-sync',
      testMatch: /holdings-aria-live-sync-status\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // HoldingCard aria-busy / error banner 結構 / 複製鍵盤操作 / exhausted 提示可讀取
      name: 'desktop-holdings-error-banner-a11y',
      testMatch: /holdings-error-banner-a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // HoldingMetaReportModal 從 HoldingCard 開啟：aria + Field label + C10 theme token + 3 條關閉路徑
      name: 'desktop-holdings-meta-report-modal',
      testMatch: /holdings-meta-report-modal\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 窄螢幕 863px（tablet）：HoldingMetaReportModal 仍能開/關 + theme token 一致
      name: 'narrow-holdings-meta-report-modal',
      testMatch: /holdings-meta-report-modal-narrow\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 863, height: 900 } },
    },
    {
      // 手機 375px：HoldingMetaReportModal 仍能開/關 + theme token 一致 + reopen 狀態清除
      name: 'mobile-holdings-meta-report-modal',
      testMatch: /holdings-meta-report-modal-narrow\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      // 儲存 → 關閉 → reopen：欄位必須從 override → currentMeta 帶回
      name: 'desktop-holdings-meta-report-modal-persist',
      testMatch: /holdings-meta-report-modal-persist\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    // RWD 防回歸：6 個斷點 × 公開頁面 → 不能有橫向 scroll
    {
      name: 'rwd-320',
      testMatch: /rwd-no-horizontal-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 700 } },
    },
    {
      name: 'rwd-375',
      testMatch: /rwd-no-horizontal-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'rwd-414',
      testMatch: /rwd-no-horizontal-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 } },
    },
    {
      name: 'rwd-560',
      testMatch: /rwd-no-horizontal-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 560, height: 900 } },
    },
    {
      name: 'rwd-768',
      testMatch: /rwd-no-horizontal-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'rwd-1023',
      testMatch: /rwd-no-horizontal-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1023, height: 900 } },
    },

    // 視覺回歸：Portal 與 /app 關鍵頁面 × 7 斷點（320/375/414/560/768/1023/1280）
    ...([320, 375, 414, 560, 768, 1023, 1280] as const).map((w) => ({
      name: `visual-${w}`,
      testMatch: /visual-regression\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),

    // 分享流程：短連結 redirect / og-card / ShareButton dropdown
    {
      name: 'desktop-share-short-link',
      testMatch: /share-short-link-redirect\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'desktop-share-og-card',
      testMatch: /share-og-card\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'desktop-share-dropdown',
      testMatch: /share-dropdown\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },

    // 手機 390px：效能概覽 X 軸 tick 不過密
    {
      name: 'mobile-perf-overview-xaxis',
      testMatch: /performance-overview-mobile-xaxis\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },

    // FreeCheckup 多圖批次解析（BatchParsePanel：progress / cancel / retry）
    {
      name: 'desktop-freecheckup-batch-parse',
      testMatch: /freecheckup-batch-parse\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 批次解析 429 / QUOTA_EXCEEDED 錯誤呈現
      name: 'desktop-freecheckup-batch-parse-quota',
      testMatch: /freecheckup-batch-parse-quota\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 批次上限 — 一次最多 10 張
      name: 'desktop-freecheckup-batch-parse-limit',
      testMatch: /freecheckup-batch-parse-limit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 單張預覽 → 手動解析（不觸發 BatchParsePanel）
      name: 'desktop-freecheckup-single-parse',
      testMatch: /freecheckup-single-parse\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /pricing — 修煉派 painPoint 文案 / 心法展開 / 方案差異比較區塊（含 mobile 390 截斷檢查）
      name: 'desktop-pricing-cultivator-copy',
      testMatch: /pricing-cultivator-copy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Pricing → Checkout：CTA 導向、ACTIVE 訂閱、成功 toast 走 aria-live
      name: 'desktop-pricing-checkout-active-aria',
      testMatch: /pricing-checkout-active-aria\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },

    // Desktop viewport 的 demo intro modal 抑制回歸（1280 / 1440 / 1920）
    ...([1280, 1440, 1920] as const).map((w) => ({
      name: `desktop-intro-modal-${w}`,
      testMatch: /freecheckup-intro-modal-desktop\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),

    // 跨瀏覽器 demo intro modal 抑制回歸（Chromium / Firefox / WebKit @ 1280）
    // 確認 localStorage/sessionStorage flag 抑制在三個引擎行為一致
    {
      name: 'desktop-intro-modal-chromium',
      testMatch: /freecheckup-intro-modal-desktop\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'desktop-intro-modal-firefox',
      testMatch: /freecheckup-intro-modal-desktop\.spec\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 900 },
        // top-level launchOptions 指向 chromium headless_shell，Firefox 需覆寫
        launchOptions: process.env.PLAYWRIGHT_FIREFOX_PATH
          ? { executablePath: process.env.PLAYWRIGHT_FIREFOX_PATH }
          : existsSync(
              '/nix/store/26hkgsdnfbd3d0ynabwxnxwr3ynrm61y-playwright-firefox/firefox/firefox',
            )
          ? {
              executablePath:
                '/nix/store/26hkgsdnfbd3d0ynabwxnxwr3ynrm61y-playwright-firefox/firefox/firefox',
            }
          : {},
      },
    },
    {
      name: 'desktop-intro-modal-webkit',
      testMatch: /freecheckup-intro-modal-desktop\.spec\.ts/,
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 900 },
        launchOptions: process.env.PLAYWRIGHT_WEBKIT_PATH
          ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_PATH }
          : existsSync('/nix/store/cz60x810qfaj6fgam615832byrd7d67q-playwright-webkit/pw_run.sh')
          ? {
              executablePath:
                '/nix/store/cz60x810qfaj6fgam615832byrd7d67q-playwright-webkit/pw_run.sh',
            }
          : {},
      },
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
