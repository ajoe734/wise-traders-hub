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
        // 抽屜極端失敗自動彙總頁 → playwright-report/drawer-failures.html
        ['./e2e/reporters/drawer-extreme-html-reporter.ts'],
      ]
    : [['list'], ['./e2e/reporters/drawer-extreme-html-reporter.ts']],
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
    // [Handoff 2026-07-15 §3.4 步驟 1] 以下 4 個 project 已隨 sparkline / tip 移到抽屜 §4.2 後移除：
    //   - iphone-390-tip-badge（.wb-tip 已從卡頭刪除）
    //   - iphone-390-sparkline-mode-parity / sparkline-width-390 / 768 / 1280
    //     （.wb-spark 於卡頭僅保留 hidden data-* 契約，不再視覺渲染）
    // 抽屜對接完成後將於 §4.2 專屬 spec 重建。

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
      // 分析師後台側邊欄：短視窗也必須能滾到底，footer 不可被吃掉
      name: 'admin-sidebar-scroll',
      testMatch: /admin-sidebar-scroll\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // /app/journal/:id 標題完整顯示 + 顯示全部/收合折疊行為
      name: 'desktop-journal-detail-title-collapse',
      testMatch: /journal-detail-title-collapse\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // /app/journal/:id owner 預覽（?preview=1）走 RPC fallback、不顯示 UnavailableContent
      name: 'desktop-journal-detail-owner-preview',
      testMatch: /journal-detail-owner-preview\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 回歸：master-brcto owner ?preview=1 → RPC 成功且不觸發 expert_signals.currency schema 錯誤
      name: 'desktop-journal-detail-owner-preview-brcto',
      testMatch: /journal-detail-owner-preview-brcto\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 管理員 / 公司管理員以 ?preview=1 預覽任何老師週記 → RPC role bypass 命中
      name: 'desktop-journal-detail-admin-preview',
      testMatch: /journal-detail-admin-preview\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // SignalDetail 預覽 schema 回歸：expert_signals.currency 不可出現在 top-level select
      name: 'desktop-signal-detail-preview-currency-schema',
      testMatch: /signal-detail-preview-currency-schema\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // SignalDetail 韌性：teaching / experts embed 欄位不完整時仍能正常渲染
      name: 'desktop-signal-detail-incomplete-teaching-fields',
      testMatch: /signal-detail-incomplete-teaching-fields\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // ChipsSection 抽屜籌碼面：空資料 / 逾時 / 部分欄位 / DOM 一致性
      name: 'desktop-chips-section',
      testMatch: /chips-section\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // ChipsSection 行動端佈局回歸：viewport 由 spec 內 test.use 動態切換
      // 覆蓋 320 / 360 / 375 / 390 / 393 / 430 六個常見手機寬度
      name: 'mobile-chips-section',
      testMatch: /chips-section-mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // ChipsSection 視覺回歸（screenshot diff）— 顏色 / STALE·OFFLINE 徽章 / 趨勢圖回放
      name: 'visual-chips-section',
      testMatch: /chips-section-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 1400 } },
    },
    {
      // PR-10: ChipsSection coalesced 徽章 UI 驗證（mock API 回傳 coalesced=true）
      name: 'desktop-chips-coalesce',
      testMatch: /chips-coalesce\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Phase G: chips 端到端事件契約（鎖 Phase F 漏斗依賴的 traffic-ingest 事件）
      name: 'desktop-chips-telemetry-contract',
      testMatch: /chips-telemetry-contract\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },














    {
      // 週記 / 訊號編輯器：ETF 英文字尾（00631L / 00878B）代號+名稱顯示 parity
      name: 'desktop-signal-editor-etf-suffix',
      testMatch: /signal-editor-etf-suffix\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // ETF 代號+名稱跨寬度視覺不截斷（00631L / 00878B），viewport 由 spec 動態切換
      name: 'etf-display-visual-parity',
      testMatch: /etf-display-visual-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 手機寬度 SignalCreateDialog 訂閱者預覽列 + PreviewTradeItem
      // 不重疊 / 不溢出 / 保留字尾（viewport 由 spec 動態切換）
      name: 'signal-preview-mobile-visual',
      testMatch: /signal-preview-mobile-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 代號/名稱 字型 + 字距 + 可讀性合約（4 表面 × 2 ETF × 3 手機斷點）
      name: 'etf-code-name-typography',
      testMatch: /etf-code-name-typography\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // @價 + 張/股 tabular-nums 不擠壓/不截斷（4 表面 × 2 ETF × 3 手機斷點 × 短/長價）
      name: 'etf-numeric-tabular-nowrap',
      testMatch: /etf-numeric-tabular-nowrap\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // SignalCreateDialog 按鍵焦點 / 字級 / 直橫切換合約
      name: 'signal-create-focus-rotate',
      testMatch: /signal-create-focus-rotate\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
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
      // Batch C §6.3 — TradeUploadModal 三條關閉路徑 + DailyTab/LogTab 切換不破版
      // 每個 test 內用 setViewportSize 自行切換桌面／手機寬度
      name: 'desktop-freecheckup-upload-modal',
      testMatch: /freecheckup-upload-modal\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Batch D §2 — 手機頂欄「⋯ 更多」actions sheet 開/關 + 選項行為
      name: 'mobile-freecheckup-actions-sheet',
      testMatch: /freecheckup-mobile-actions-sheet\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
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
      // PriceAxis / RangeBand 圓點必須永遠是正圓（不被 preserveAspectRatio=none SVG 拉扁）
      name: 'holdings-price-axis-dot-shape',
      testMatch: /holdings-price-axis-dot-shape\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 圓點視覺回歸：像素快照比對，雙保險擋 SVG <circle> 回退 / 橢圓形變
      name: 'holdings-price-axis-dot-visual',
      testMatch: /holdings-price-axis-dot-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
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
      // 目標價 = 0 回歸：0 不被 falsy 吞成空白 / null；折疊再展開仍保留 0
      name: 'desktop-holdings-target-price-zero',
      testMatch: /holdings-target-price-zero\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // RangeBand 資料源一致性偵測：SPARK_VS_PRICE_DRIFT / PRICE_OUT_OF_RANGE / SPARK_OUT_OF_RANGE
      // 透過 preview-only harness 注入分歧 price / spark，驗證琥珀警示 + data-inconsistent 屬性
      name: 'desktop-holdings-range-band-inconsistency',
      testMatch: /holdings-range-band-inconsistency\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 640, height: 480 } },
    },
    {
      // today-delta wrap + 抽屜區塊節奏守門：窄屏 4 斷點 + 寬屏 3 斷點 + 節奏測 + sparkline 移除斷言
      // spec 內部用 page.setViewportSize 手動控制多斷點，這裡只需單 project 入口
      name: 'holdings-detail-today-delta-wrap',
      testMatch: /holdings-detail-today-delta-wrap\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // NotificationBell link routing：內部路徑走 navigate、Storage signed URL 走新分頁、null 不動作
      name: 'desktop-notification-link-routing',
      testMatch: /notification-link-routing\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 提前開放 → /app/ 通知呈現：TW / US 兩市場全鏈文案不得出現「下週」
      name: 'desktop-early-publish-copy',
      testMatch: /early-publish-copy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 週記匯出：單一老師 .md / 多位老師 .zip 檔名與內容驗證（透過 harness fixture）
      name: 'desktop-journals-export-markdown',
      testMatch: /journals-export-markdown-download\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：檔名 slug 對應 + Markdown 週別標題與前端顯示一致
      name: 'desktop-journals-export-filename-week-parity',
      testMatch: /journals-export-filename-and-week-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：跨多週別 / 重複下載 / 重新掛載的檔名 × slug × 週別 parity 矩陣
      name: 'desktop-journals-export-parity-matrix',
      testMatch: /journals-export-parity-matrix\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：quantity_unit 為空 / 不存在 / null / 純空白時，仍預設使用「股」
      name: 'desktop-journals-export-quantity-unit-default',
      testMatch: /journals-export-quantity-unit-default\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：每位老師「本週總計」買進/賣出與 fixture 完全一致
      name: 'desktop-journals-export-weekly-totals',
      testMatch: /journals-export-weekly-totals\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：單一老師同時擁有「張／股」→ 本週總計必須分段標示
      name: 'desktop-journals-export-dual-unit-totals',
      testMatch: /journals-export-dual-unit-totals\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：彥愷 4576 迴歸（buy 1 張 + add 999 股，無賣出，不得出現「賣出 1 張」或單位錯亂）
      name: 'desktop-journals-export-yankai-4576',
      testMatch: /journals-export-yankai-4576-no-sell\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：風險守門（單位/方向不一致時阻擋，管理員可強制放行）
      name: 'desktop-journals-export-risk-gate',
      testMatch: /journals-export-risk-gate\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：本週總計 parser 對 CRLF / 額外空白 / 全形冒號等 whitespace 變體的容忍度
      name: 'desktop-journals-export-weekly-totals-whitespace',
      testMatch: /journals-export-weekly-totals-whitespace-tolerance\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：週別/日期範圍在多老師 zip 內完全一致，且與 fixture 對齊
      name: 'desktop-journals-export-week-label-consistency',
      testMatch: /journals-export-week-label-consistency\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：zip 內檔名 / slug / 防碰撞完整性
      name: 'desktop-journals-export-zip-filename-slug-integrity',
      testMatch: /journals-export-zip-filename-slug-integrity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：週別行分隔符 (~ 〜 ～ — – - to 至 等) 變體寬容解析
      name: 'desktop-journals-export-week-separator-tolerance',
      testMatch: /journals-export-week-separator-tolerance\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：「- 週別：」行在單一/多老師匯出中位置固定於 H1 之後 header 群首位
      name: 'desktop-journals-export-week-line-position',
      testMatch: /journals-export-week-line-position\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：Windows CRLF vs LF 換行下週別行 index 2 與解析結果一致
      name: 'desktop-journals-export-week-line-newline-parity',
      testMatch: /journals-export-week-line-newline-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：BOM × 換行 6 變體下 header 順序與週別行位置不變
      name: 'desktop-journals-export-bom-newline-header-order',
      testMatch: /journals-export-bom-newline-header-order\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },
    {
      // 週記匯出：老師輸入順序改變下週別行仍在 index 2 且 header 不跨老師污染
      name: 'desktop-journals-export-mentor-order-header-isolation',
      testMatch: /journals-export-mentor-order-header-isolation\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },


    {
      // 週記匯出：缺失 slug / 資產類別 / 幣別（甚至 experts=null）時 header 完整且週別行位置固定
      name: 'desktop-journals-export-missing-fields-week-line',
      testMatch: /journals-export-missing-fields-week-line\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },

    {
      // 週記匯出：週別行字面快照（缺欄位情境下不得被 fallback 改寫）
      name: 'desktop-journals-export-week-line-literal-snapshot',
      testMatch: /journals-export-week-line-literal-snapshot\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },

    {
      // 週記匯出：缺失 slug/資產/幣別（含 experts=null）的 fallback 視覺呈現與 header 位置
      name: 'desktop-journals-export-missing-fields-fallback-visual',
      testMatch: /journals-export-missing-fields-fallback-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },

    {
      // 週記匯出：zip 內檔案排序 + 連續匯出並行情境下週別行仍固定 index 2 且無跨檔污染
      name: 'desktop-journals-export-zip-order-and-concurrency',
      testMatch: /journals-export-zip-order-and-concurrency\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },

    {
      // 週記匯出：Markdown 解析器反查 — 週別行位置與 (start,end) 必須一致
      name: 'desktop-journals-export-week-line-parser-parity',
      testMatch: /journals-export-week-line-parser-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },

    {
      // 週記匯出：UTF-8/BOM raw bytes 合規 + CRLF/LF 五種正規化變體週別行一致性
      name: 'desktop-journals-export-utf8-bom-newline-parity',
      testMatch: /journals-export-utf8-bom-newline-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },

    {
      // 週記匯出：空資料 / 取消對話框 / 失敗重試 UI 回饋，含最終匯出週別行 index 2 完整性
      name: 'desktop-journals-export-ui-feedback',
      testMatch: /journals-export-ui-feedback\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
    },


    {
      // 週記匯出：header 區塊（L0..L8）DOM ↔ markdown text 一致性 + 元素截圖視覺快照
      name: 'desktop-journals-export-header-dom-parity',
      testMatch: /journals-export-header-dom-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 週記匯出：zip 內同名週記 / slug 撞名 / slug fallback 撞名 / 重複 expert_id 情境下
      // 檔名必須 dedup 唯一、週別行仍固定 index 2，且不得跨老師污染
      name: 'desktop-journals-export-duplicate-slug-and-name',
      testMatch: /journals-export-duplicate-slug-and-name\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, acceptDownloads: true },
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

    // FreeCheckup 6 個主要分頁（Holdings/News/Daily/Events/Log/Research）視覺回歸
    // × 3 斷點（375 手機 / 768 平板 / 1280 桌面）
    ...([375, 768, 1280] as const).map((w) => ({
      name: `freecheckup-tabs-${w}`,
      testMatch: /freecheckup-tabs-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),



    // Batch F — Checkup token / accent / 字型 漂移守門 × 4 常見斷點
    ...([390, 768, 1024, 1280] as const).map((w) => ({
      name: `checkup-tokens-${w}`,
      testMatch: /checkup-tokens-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),

    // HoldingsDetailPanel ROI 字級守門 — 憲法：computed fontSize ≤ 22px
    // 覆蓋 iPhone SE / iPhone 12 / iPhone Pro Max / tablet / laptop / desktop 六個常見斷點
    ...([320, 375, 390, 414, 560, 768, 1024, 1280] as const).map((w) => ({
      name: `holdings-detail-roi-fontsize-${w}`,
      testMatch: /holdings-detail-panel-roi-fontsize\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),

    // HoldingsDetailPanel 抽屜整體守門 — legacy drawer 不得存在、無水平溢出、全域字級 ≤ 22px
    // 失敗產物落點：test-results/holdings-drawer/rwd-integrity-<w>/
    ...([320, 375, 390, 414, 560, 768, 863, 1024, 1280] as const).map((w) => ({
      name: `holdings-detail-rwd-integrity-${w}`,
      testMatch: /holdings-detail-panel-rwd-integrity\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/rwd-integrity-${w}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),

    // HoldingsDetailPanel 抽屜 · 視覺快照回歸（多斷點）— pixel diff 防溢出/佈局跳動
    // 失敗產物落點：test-results/holdings-drawer/visual-snapshot-<w>/
    // 斷點分佈：
    //   極小 320/360/375/390/414/430  → iPhone SE ~ 15 Pro Max、Android baseline
    //   中段 480/560/640/768/863      → phablet / iPad mini / iPad
    //   大   1024/1280/1440/1920      → laptop / desktop / QHD
    ...([320, 360, 375, 390, 414, 430, 480, 560, 640, 768, 863, 1024, 1280, 1440, 1920] as const).map((w) => ({
      name: `holdings-detail-visual-snapshot-${w}`,
      testMatch: /holdings-detail-panel-visual-snapshot\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/visual-snapshot-${w}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),


    // HoldingsDetailPanel 抽屜 · 互動守門（ESC / 遮罩 / Tab 焦點循環 / 焦點陷阱）
    // 覆蓋全 15 斷點（wide + narrow 皆納入）—— 與 visual-snapshot 一致
    // 失敗產物落點：test-results/holdings-drawer/interaction-<w>/
    ...([320, 360, 375, 390, 414, 430, 480, 560, 640, 768, 863, 1024, 1280, 1440, 1920] as const).map((w) => ({
      name: `holdings-detail-interaction-${w}`,
      testMatch: /holdings-detail-panel-interaction\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/interaction-${w}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),


    // HoldingsDetailPanel 抽屜 · 多資料量 RWD 溢出守門
    // count ∈ {1,10,50} × viewport ∈ {320,390,768,1280}（共 12 組合）
    // 失敗產物落點：test-results/holdings-drawer/volume-rwd-<w>/
    ...([320, 390, 768, 1280] as const).map((w) => ({
      name: `holdings-detail-volume-rwd-${w}`,
      testMatch: /holdings-detail-panel-volume-rwd\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/volume-rwd-${w}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 1400 } },
    })),

    // HoldingsDetailPanel 抽屜 · 極端內容壓力（長標題 / 多行摘要 / 大量列表）
    // stress ∈ {long-title, multiline, mega-list, all} × viewport ∈ {320,390,768,1280}
    // spec 內部再 × 3 scroll 位置（共 16 test × 3 audit = 48 個實際 audit 點）
    // 失敗產物落點：test-results/holdings-drawer/stress-content-<w>/
    ...([320, 390, 768, 1280] as const).map((w) => ({
      name: `holdings-detail-stress-content-${w}`,
      testMatch: /holdings-detail-panel-stress-content\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/stress-content-${w}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 1400 } },
    })),

    // HoldingsDetailPanel 抽屜 · 內部垂直捲動不得觸發水平溢出（含 scroll-to-bottom）
    //   × 3 scroll 方式（programmatic / wheel / keyboard）× 6 段位置（0~100%）× 來回
    //   覆蓋全 15 斷點 —— 與 visual-snapshot 一致
    // 失敗產物落點：test-results/holdings-drawer/scroll-overflow-<w>/
    ...([320, 360, 375, 390, 414, 430, 480, 560, 640, 768, 863, 1024, 1280, 1440, 1920] as const).map((w) => ({
      name: `holdings-detail-scroll-overflow-${w}`,
      testMatch: /holdings-detail-panel-scroll-overflow\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/scroll-overflow-${w}`,
      // 高度刻意壓低到 720，逼抽屜內容溢出容器 → 觸發內部垂直捲動路徑
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 720 } },
    })),


    // HoldingsDetailPanel 抽屜 · 載入中（skeleton）→ 渲染完成（ready）全流程幾何守門
    //   × 2 loading 延遲（400ms / 1200ms）× 3 phase（skeleton / transition / ready）
    //   = 每 viewport 2 test × 3 audit
    // 失敗產物落點：test-results/holdings-drawer/loading-to-ready-<w>/
    ...([320, 390, 768, 1280] as const).map((w) => ({
      name: `holdings-detail-loading-to-ready-${w}`,
      testMatch: /holdings-detail-panel-loading-to-ready\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/loading-to-ready-${w}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 900 } },
    })),

    // HoldingsDetailPanel 抽屜 · 極端視窗 × 旋轉 × 滾動位置 幾何守門
    //   portrait ultra-narrow / iphone / landscape rotation / keyboard-open short /
    //   tall narrow / tablet portrait+landscape / ultra-wide desktop
    // 每組合另在 top / mid / bottom 三個 scroll 位置做 audit
    // 失敗產物落點：test-results/holdings-drawer/rwd-extreme-<slug>/
    ...([
      { slug: 'fold-280x653',       w: 280,  h: 653 },
      { slug: 'android-360x640',    w: 360,  h: 640 },
      { slug: 'iphone-15-pmax',     w: 430,  h: 932 },
      { slug: 'iphone-se-land',     w: 667,  h: 375 },
      { slug: 'iphone-x-land',      w: 812,  h: 375 },
      { slug: 'iphone-12-land',     w: 844,  h: 390 },
      { slug: 'iphone-pmax-land',   w: 896,  h: 414 },
      { slug: 'iphone-15pmax-land', w: 932,  h: 430 },
      { slug: 'kbd-390x420',        w: 390,  h: 420 },
      { slug: 'kbd-414x500',        w: 414,  h: 500 },
      { slug: 'tall-320x1200',      w: 320,  h: 1200 },
      { slug: 'ipad-820x1180',      w: 820,  h: 1180 },
      { slug: 'ipad-land-1180x820', w: 1180, h: 820 },
      { slug: 'desktop-1440x900',   w: 1440, h: 900 },
      { slug: 'fhd-1920x1080',      w: 1920, h: 1080 },
      { slug: 'uw-2560x1080',       w: 2560, h: 1080 },
    ] as const).map(({ slug, w, h }) => ({
      name: `holdings-detail-rwd-extreme-${slug}`,
      testMatch: /holdings-detail-panel-rwd-extreme\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/rwd-extreme-${slug}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: h } },
    })),

    // Journal PDF 匯出 — 字型 / accent 色漂移守門 × 3 常見桌面/平板寬度
    // 頁面本身固定 794px，跨 viewport 主要是 catch 外層 layout / 字型延遲 fallback
    ...([768, 1024, 1280] as const).map((w) => ({
      name: `journal-pdf-visual-${w}`,
      testMatch: /journal-pdf-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: 1400 } },
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

    // HoldingsDetailPanel 抽屜 · 多裝置滾動守門（iOS + Android + 折疊 + 平板 + 直橫）
    //   驗證 100dvh 契約、可滾到最底、最後元素不被底部遮住
    // 失敗產物落點：test-results/holdings-drawer/scroll-bottom-<slug>/
    ...([
      // ---- iOS 直向 ----
      { slug: 'ios-se-375x667',        w: 375,  h: 667 },
      { slug: 'ios-12mini-375x812',    w: 375,  h: 812 },
      { slug: 'ios-13-390x844',        w: 390,  h: 844 },
      { slug: 'ios-14pro-393x852',     w: 393,  h: 852 },
      { slug: 'ios-14plus-428x926',    w: 428,  h: 926 },
      { slug: 'ios-15pmax-430x932',    w: 430,  h: 932 },
      // ---- iOS 橫向（URL bar + home indicator 最容易吃到底部）----
      { slug: 'ios-se-land-667x375',   w: 667,  h: 375 },
      { slug: 'ios-13-land-844x390',   w: 844,  h: 390 },
      { slug: 'ios-15pmax-land',       w: 932,  h: 430 },
      // ---- iPad ----
      { slug: 'ipad-mini-768x1024',    w: 768,  h: 1024 },
      { slug: 'ipad-820x1180',         w: 820,  h: 1180 },
      { slug: 'ipad-land-1180x820',    w: 1180, h: 820 },
      // ---- Android 直向 ----
      { slug: 'android-small-360x640', w: 360,  h: 640 },
      { slug: 'pixel5-393x851',        w: 393,  h: 851 },
      { slug: 'galaxy-s20-360x800',    w: 360,  h: 800 },
      { slug: 'pixel7pro-412x915',     w: 412,  h: 915 },
      { slug: 'galaxy-s23u-412x915',   w: 412,  h: 915 },
      // ---- Android 折疊機（極窄）----
      { slug: 'fold-outer-280x653',    w: 280,  h: 653 },
      { slug: 'fold-inner-717x512',    w: 717,  h: 512 },
      // ---- Android 橫向 ----
      { slug: 'pixel5-land-851x393',   w: 851,  h: 393 },
      { slug: 'pixel7pro-land',        w: 915,  h: 412 },
    ] as const).map(({ slug, w, h }) => ({
      name: `holdings-drawer-scroll-bottom-${slug}`,
      testMatch: /holdings-drawer-scroll-bottom-devices\.spec\.ts/,
      outputDir: `test-results/holdings-drawer/scroll-bottom-${slug}`,
      use: { ...devices['Desktop Chrome'], viewport: { width: w, height: h } },
    })),

    {
      // traffic-ingest CORS 合約：白名單 echo origin + Allow-Credentials + Vary
      name: 'traffic-ingest-cors',
      testMatch: /traffic-ingest-cors\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 深模組 route smoke（7 條 /portfolio/me/*）
      name: 'portfolio-modules-smoke',
      testMatch: /portfolio-modules-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // 跨模組導覽
      name: 'module-cross-nav',
      testMatch: /module-cross-nav\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Shell Event Bus E2E harness（docs/architecture/shell-event-bus.md §5）
      name: 'shell-event-bus-navigation',
      testMatch: /shell-event-bus-navigation\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Shell Event Bus v2：closing:openStock / research:prefill / events:refresh
      // 覆蓋 M1→M2、M2/M3→M5 導航與 M4→M3 pub/sub tick（docs §8-2）
      name: 'shell-event-bus-nav-v2',
      testMatch: /shell-event-bus-nav-v2\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Phase 6 — 持倉看板價格權威 E2E（docs/architecture/price-authority.md）
      //   驗證 daily_price_snapshots / current_prices / expert_signal_legs 三條 API
      //   contract + navigator.onLine=false 離線 fallback 不 crash。
      name: 'holdings-price-parity',
      testMatch: /holdings-price-parity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
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
