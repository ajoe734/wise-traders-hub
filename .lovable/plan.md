## 目的

把對外路徑從 `/free-checkup` 改成語意正確的 `/holding-checkup`（持股健檢）。舊路徑保留 redirect，內部檔名/資料夾不動以免炸到 import 與 memory 中的硬合約。

## 改動範圍

**路由（src/App.tsx）**
- 新增主路由 `/holding-checkup` → `FreeCheckupPage`
- 舊路由 `/free-checkup` 保留為 redirect 元件 → `<Navigate to={"/holding-checkup" + location.search} replace />`
  - 保留 query string（例如 `?line_error=internal`、`?return_to=...`），確保 Line 回呼、舊書籤、SEO 連結不壞

**站內所有 `/free-checkup` 字串改為 `/holding-checkup`**
- `src/pages/Index.tsx`（4 處 `<Link>`）
- `src/pages/app/AppHome.tsx`（捷徑卡片）
- `src/pages/CheckupCheckout.tsx`（付款成功後 `navigate("/free-checkup")`）
- `src/pages/FreeCheckup.jsx` L2580 內 `path` 字串
- `src/checkup/components/DedupSettingsButton.tsx` 的 `path.startsWith` 改成同時相容新舊路徑：`startsWith('/holding-checkup') || startsWith('/free-checkup')`
- `src/checkup/hooks/useTargetPriceHistory.js` 內 `link` 字串
- `src/pages/auth/LineCallback.tsx`：fallback 預設值 `/free-checkup` → `/holding-checkup`
- `supabase/functions/line-login-authorize/index.ts`：預設 `returnTo`
- `supabase/functions/line-login-callback/index.ts`：3 處預設值與錯誤頁 `Location` 跳轉

**測試 / 文件**
- `e2e/freecheckup-card.spec.ts`：`ROUTE` 常數
- `docs/demo-data-maintenance.md`、`src/checkup/DESIGN_SPEC.md`、`src/checkup/components/holdings/README.md` 內出現的 `/free-checkup` 文字
- `playwright.config.ts` 註解（可選）

## 不動的部分

- **檔名與資料夾不改**：`FreeCheckup.jsx`、`_freeCheckup/`、`components/freecheckup/`、`useFreeCheckupBootstrap.js`、test 檔名等全部保留。改名會牽動大量 import 與 memory 中標註的硬合約（`wb-hero-grid` / `.wb-card`、L2965/L4745 `<style>`），風險高、收益低。
- **DB schema、edge function 名稱、`checkup-analyze` 邏輯、訂閱/付款/quota** 完全不動。
- **「持股健檢」中文文案** 不動。

## 驗收

- 直接打 `/holding-checkup`：正常進入持股健檢頁，Demo 模式、訂閱模式皆正常
- 直接打 `/free-checkup`：自動轉到 `/holding-checkup`，query string 保留
- Line 登入 callback 後 fallback 正確落在 `/holding-checkup`
- 首頁 / AppHome / 付款成功 導向皆為 `/holding-checkup`
- `bunx playwright test e2e/freecheckup-card.spec.ts` 通過
- 既有 mobile RWD（560/390/380）、closing analysis、AI 分析、quota 行為皆不變