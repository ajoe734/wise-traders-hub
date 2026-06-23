## 根因（已驗證）

右側 Lovable Preview 不是乾淨未登入訪客 — 已有 auth session（已從 auth logs 看到 `/user` 200）。所以 `CheckupModeProvider` → `mode='full'` → `isDemo=false` → `useFreeCheckupBootstrap` 走雲端載入分支，讀到空持倉、寫入 `pf-holdings-v2=[]`、顯示「還沒有持倉資料」。

e2e 用乾淨 context、無 session → `isDemo=true` → demo seed 注入 20 檔，所以通過。

兩者都是正確行為，問題是 Preview 與 e2e 覆蓋情境不同，不該強塞 demo 給已登入空倉使用者。

## 變動範圍

只動 3 處，不改 UI、不改 demo 資料源、不改 `INIT_HOLDINGS`、不改文案、不改正式資料流。

### 1. `src/hooks/useFreeCheckupBootstrap.js` — dev-only debug log

新增 `DBG` 內部 helper，只在 `import.meta.env.DEV && location.pathname.startsWith('/holding-checkup')` 啟用，正式 build 為 no-op。輸出欄位（**不含** uid/email/token）：

- `authReady`、`isDemo`、`mode`（透過 isDemo 推導）
- demo 分支：`demo-seed-applied { holdingsLen }`
- 正式分支：`hasUser`、`hasProfile`、`pf-reset-flag` 是否存在、`sanitizedHoldings.length`、`removedDemoSeedCount`

### 2. `src/pages/FreeCheckup.jsx` — 最小覆蓋追蹤

只新增一個 dev-only `useEffect`，依 `holdings?.length` 變化 log「N→0」或「0→N」轉換，附 `isDemo / ready / authReady / tab` 與 `pf-reset-flag` 是否存在。**不包裝 setHoldings、不改任何 setter**。

### 3. e2e 補兩種 case

更新 `e2e/freecheckup-demo-first-fold.spec.ts`：

**Case A（保留並強化）— 乾淨未登入訪客**：
- `DemoBanner` 必存在
- `TODAY'S P&L` 文字 `+11,624`（demo 固定值）
- `還沒有持倉資料` 不存在
- 至少 20 檔（透過 `共 20 檔` 字串或多個 demo code 並存斷言）
- `ACTION PRIORITY` 可見
- `video` count = 0
- `coachmarks-dialog` 不可見

**Case B（新增）— authenticated empty portfolio**：
- 使用 `e2e/helpers/supabase-mock.ts`（已存在）建立假 session + 攔截 `pf-*` 雲端讀取回空，**不依賴** Lovable Preview session
- 進 `/holding-checkup`
- 斷言：`DemoBanner` 不存在、`還沒有持倉資料` 可見、`+11,624` 不可見、demo codes（3443/3017/2308）皆不在 DOM
- 明確標示這不是 demo failure

若 supabase-mock helper 無法注入 session，改用 `addInitScript` 預先寫入 `sb-{ref}-auth-token` localStorage 並 stub `/auth/v1/user` 回 200 假 user + `/rest/v1/checkup_storage` 回空陣列。

## 不做的事

- 不改 `useFreeCheckupBootstrap` demo 判斷條件
- 不強塞 demo 給已登入空倉使用者
- 不加 UI debug、不加文案
- 不依賴 `LOVABLE_BROWSER_SUPABASE_*` env 當 e2e fixture（只用於人工排查，不寫進 spec）

## 驗收

1. `bunx playwright test e2e/freecheckup-demo-first-fold.spec.ts` 兩個 case 全綠
2. 確認 dev console 在 `/holding-checkup` 會輸出受控 debug；prod build 無輸出
3. 回報：
   - 乾淨未登入訪客結果（demo 20 檔）
   - 已登入空倉結果（空狀態，無 DemoBanner）
   - Preview 與 e2e 差異原因說明
   - 修改檔案清單
   - debug 是否 dev-only
   - 測試結果

## 給使用者的 Preview 操作備註

要在 Lovable Preview 看 demo：登出或用隱身視窗開 `/holding-checkup`。本輪不為了預覽方便而新增 dev-only demo override。