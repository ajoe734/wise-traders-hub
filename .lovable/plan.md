# 全站效能改善方案（依 perf-audit-2026-06）

依審計報告，分三波執行，每波結束跑 `bundle-snapshot` + RUM 驗證。

---

## Wave P0 — 本週（首屏體驗止血）

### P0-1 Index.tsx CLS 4.65 → <0.1
- 把 `Index.tsx` 內所有 `<LazyOnVisible mode="io">` 的折疊段（hero 下方 sections）改為 `mode="content-visibility"`，placeholder 高度透過 `contain-intrinsic-size` 撐住，避免 mount 時 reflow。
- 首屏 hero `<img>` / 插圖（包含 `divider-choose-path.svg`、`icon-*-circle.svg`）全部補 `width` / `height` / `aspect-ratio`。
- `MobileCarousels.tsx` 等 above-the-fold 動態高度元件，外層套固定 `min-height` 並改 `aspect-ratio` 撐位。

### P0-2 Index.tsx LCP 23.8s
- Hero 主視覺輸出 webp/avif（透過 `vite-imagetools` 或事前壓縮），於 `index.html` 加 `<link rel="preload" as="image" fetchpriority="high">`。
- 審 `Index.tsx` 頂部 import：把僅在折疊段使用的元件改 `React.lazy` + 配 `LazyOnVisible(io)`；hero 段保留同步。

### P0-3 FreeCheckup main chunk 287KB → <200KB
落實 `.lovable/freecheckup-a1.md` 三個低垂果實：
1. `src/checkup/data/demoData.js`（15.3 KB）在 `useFreeCheckupBootstrap` 的 `if (isDemo)` 分支改 `await import()`。
2. 移除 `react-helmet-async`（31.5 KB）於 FreeCheckup 的使用，改 `useEffect` 直接 set `document.title` / meta（保留其他頁面 helmet 用法）。
3. `edgeSchemas / edgeFieldUI / edgeCoerce`（共 ~18 KB）只在 parse-flow 用到 — 改動態 import 進對應 handler。

### P0 驗證
- `npm run build && node scripts/bundle-snapshot.mjs` 比對 v2→v3。
- 預覽手動跑 Lighthouse 確認 Index CLS、FreeCheckup transfer size。
- `bunx playwright test e2e/freecheckup-card.spec.ts` 不得退化。

---

## Wave P1 — 本月（大檔重構 + N+1）

### P1-1 抽 `useCheckoutFlow({ kind })` 統一三個結帳
範圍：`Checkout.tsx` (808) + `CheckupCheckout.tsx` (363) + `AppCheckout.tsx` (562) = 1733 行 / 18 sb / 0 query。
- 新增 `src/hooks/useCheckoutFlow.ts`：plan 載入、provider 列表、cross-discount、upgrade credit、create-order mutation 全收進來，回傳 `{ plan, providers, price, isProcessing, checkout }`。
- 三檔僅保留版面差異（path、文案、品牌），目標各檔 ≤ 350 行。
- 對應 test：`src/test/components/AppCheckout.test.tsx` 同步更新。

### P1-2 N+1 收斂
| 頁面 | 現況 | 行動 |
|---|---|---|
| `company/Dashboard.tsx` | 9 sb / 1 rq | 抽 `useCompanyDashboard()` 用 `Promise.all` 或新 RPC |
| `admin/Dashboard.tsx` | 10 sb / 2 rq | 抽 `useAdminDashboard(slug)` |
| `company/Users.tsx` | rq=0 但測試合約寫了 query key | 修回 `useQuery(['company','users',debouncedSearch])` 對齊 batch5b 合約 |

### P1-3 巨檔拆分
- `company/Payments.tsx` (864)：抽 `usePayments()` + 拆 `PaymentsTable` / `PaymentDetailDialog` / `PaymentFilters`。
- `company/Plans.tsx` (742)：抽 `usePlansAdmin()` + 拆 `PlanFormDialog` / `PlanTable`。
- `admin/Profile.tsx` (610)：抽 `useProfileForm` + `useFormDraft`，8 sb → mutation。
- `admin/Performance.tsx` (695)：確認 Recharts 已 lazy（若否則 `React.lazy(() => import('@/components/...Chart'))`），抽 `usePerformanceData`。
- `admin/Signals.tsx` (1246, B4 二輪)：拆 detail dialog / batch row 元件。
- `company/BacktestMonitor.tsx` (664)：Recharts lazy 確認 + 抽 `useBacktestMonitor`。
- `app/Account.tsx` (562)：抽 `useAccountSubscriptions`。

### P1 驗證
- 每檔 PR 後 `bunx vitest run` 全綠 + `wc -l` 確認瘦身。
- bundle-snapshot 比對 chunk 大小。

---

## Wave P2 — 季度（一致性 + 後台收斂）

### P2-1 23 個小頁面 sb 直查 → useMutation
`account/Profile / Notifications`、`admin/Plans / ReasonTemplates / SignalTemplates`、`company/Announcements / FunctionLogs / Knowledge* / PaymentSettings / MissingPrices / Remittance` 等：把 mutation 路徑全包 `useMutation` 統一 toast / invalidate。

### P2-2 FreeCheckup 第二輪
- quota / refund / coverage 三 modal 抽 lazy 子元件，預估再省 20-30 KB。
- 維持 `<style>` 憲法區硬合約不動。

### P2-3 `/checkup` component-level 審計
9 個 thin wrapper 行數小但 `src/checkup/components/*` 內容龐大；另開一輪 component-level 報告（不在本路由表）。

### P2-4 觀測強化
- `scripts/bundle-snapshot.mjs` 設為固定基線，每次 PR 比對。
- 確認 framer-motion / motion 是否進入 vendor chunk；否則加入 `vite.config.ts` manualChunks。
- 修預覽環境 `/version.json` 404（prod 已 OK，預覽補一個空檔即可）。

---

## 執行順序與交付物

```
週次  項目                        檔案產出
W1   P0-1 CLS                    Index.tsx, LazyOnVisible 用法
W1   P0-2 LCP preload            index.html, vite.config
W1   P0-3 FreeCheckup 3 招       useFreeCheckupBootstrap.js, FreeCheckup.jsx
W2-3 P1-1 useCheckoutFlow        src/hooks/useCheckoutFlow.ts + 3 頁
W3   P1-2 N+1                    useCompanyDashboard, useAdminDashboard, Users.tsx
W4   P1-3 巨檔拆分（分 PR）       對應 hooks + 子元件
Q    P2 全部                     mutation 收斂 + modal lazy + 觀測
```

每波結束跑：`npm run build` → `bundle-snapshot.mjs` → 預覽 Lighthouse → 一週後回看 RUM。

---

## 技術細節備忘

- `LazyOnVisible` 已支援 `mode="content-visibility"`（見現有實作），P0-1 只需切 prop。
- FreeCheckup `<style>` 字面字串憲法不可動（搜 `wb-hero-grid` / `.wb-card`），抽 modal 時繞開。
- 任何 inline `fontSize ≥ 32` 必須同步加 `className` + `<style>` 媒體查詢 `≤560px` `≤380px`，否則 iPhone 寬度溢位（Core 規則）。
- Checkout flow 涉及訂閱/手動續訂模型，動 hook 時不可改業務邏輯（[Manual renewal model](mem://billing/manual-renewal-model)）。
- 交易時段限制 Mon-Fri 08:00–20:00 UTC+8 — 任何訊號相關 mutation 不可放寬窗口。
