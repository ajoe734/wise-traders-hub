## 下一步：強制刷新預覽以載入新 build

### 現況
程式碼層面已全部修好：
- `Legal` 改為 eager import（`App.tsx`）
- `routePrefetch.ts` 已移除 `import("@/pages/Legal")`
- `RouteChunkBoundary` + `reloadForFreshBundle` 已就位
- `versionCheck` / `edgeFetchInterceptor` 改為 static import

但瀏覽器仍卡在**舊的 `index.html`**，那份 HTML 還會請求已不存在的 `Legal-fd8powPa.js`、`versionCheck-TDZaAo11.js`，所以一直 404 + 白屏。網址列的 `?__lovable_sha=18f504ec&__v=...` 只是 query string，無法繞過 CDN 對 `/index.html` 的快取。

### 動作（兩擇一，使用者操作）

**選項 A（推薦）：Publish → Update**
- 桌面：右上角 Publish 按鈕 → Update
- 行動：右下 `...` → Publish → Update
- 會把新的 `index.html`（含正確 chunk hash）推到 CDN，所有訪客自動拿到修好版本。

**選項 B：強制硬重新整理預覽**
- Mac：`Cmd + Shift + R`
- Win：`Ctrl + Shift + R`
- 或在預覽 iframe 工具列點重新整理鈕兩次
- 只解決你本機，其他人仍會看到舊 HTML，直到你 Publish。

### 不需要再改任何程式碼
目前所有可能造成 `Legal-*.js` 動態 import 的路徑都已清乾淨，再多改一輪 code 也不會讓已被瀏覽器快取的舊 HTML 變新。問題只剩「讓瀏覽器拿到新 HTML」。

### 驗證
重新整理 / Publish 後：
1. DevTools → Network → 確認 `index.html` 不再引用 `Legal-fd8powPa.js`
2. 進 `/legal` 不再白屏，console 無 `Failed to fetch dynamically imported module`
