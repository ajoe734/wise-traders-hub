## 目標

只動 `src/pages/FreeCheckup.jsx`（7,200 行）的**可讀性**，不破憲法、不抽 UI、不換樣式、不改行為。完成後檔案會少 ~500 行，IDE 可一鍵折疊出 10 餘個區段。

---

## 動作（三步，依序）

### Step 1：把全域 `<style>` 字串外移成純常數

`FreeCheckup.jsx` 內目前有 3 個 inline `<style>{`...`}</style>` 區塊：
- L2964：全站樣式（fonts、reset、`.wb-card` RWD、Hero `@media` 斷點等，估 ~400 行）
- L4745：子分頁樣式（估 ~80 行）
- L5862：`@keyframes checkup-spin`（單行，留著）

做法：
1. 新增 `src/pages/FreeCheckup.styles.ts`，export 兩支純字串常數：
   ```ts
   export const FREE_CHECKUP_GLOBAL_CSS = `...原 L2964 內容...`;
   export const FREE_CHECKUP_SUBPAGE_CSS = `...原 L4745 內容...`;
   ```
2. `FreeCheckup.jsx` 改為：
   ```jsx
   import { FREE_CHECKUP_GLOBAL_CSS, FREE_CHECKUP_SUBPAGE_CSS } from './FreeCheckup.styles';
   ...
   <style>{FREE_CHECKUP_GLOBAL_CSS}</style>
   ...
   <style>{FREE_CHECKUP_SUBPAGE_CSS}</style>
   ```
3. **CSS 內容一字不改**，只是搬家。Hero `≤560/≤380` 的 media-query 全部跟著搬走但保留原文。

成果：FreeCheckup.jsx 從 7,200 → ~6,700 行。

### Step 2：加 `// #region` 折疊標記（不動程式碼）

掃 `App()`（L435 起）的 JSX return，依語意切 region，每個 region 開頭與結尾加註解：
```jsx
// #region Hero — 總損益 / 報酬率 / 標題列
... 既有 JSX ...
// #endregion

// #region Holdings — .wb-card 持倉看板
...
// #endregion

// #region Watchlist — 觀察清單
// #region Tab: Events
// #region Tab: Trade
// #region Tab: Log
// #region Tab: Brain
// #region Tab: Daily Report
// #region Modals — Edit / Delete / Lightbox
```

檔頭常數區同樣切：
```jsx
// #region Constants — 政策 / 顏色 / 種子資料
// #region Helpers — 純函式
```

VSCode / Cursor 會自動折疊；不影響執行、不影響測試。

### Step 3：抽純邏輯到 hook（沿用 Step 4 已建立的模式）

延續上一輪 `useLogPanelFilters` / `useDialogEscape` 的做法，再抽 2 個明確無 UI 副作用的 hook（不抽 UI 元件，遵守 inline 憲法）：

- `src/checkup/hooks/useFreeCheckupClock.js`：把目前散在 `App()` 內的 `now / isTradingHours / formatResetCountdown` 相關 `useState + useEffect` 收進來。
- `src/checkup/hooks/useFreeCheckupRetry.js`：把 `RETRY_POLICY` / `classifyAttempt` / `deriveSuggestion`（L29–L120）的 ref 與 setter 收成單一 hook。

只搬 hook 內部用得到的 state/effect/helper。所有 JSX 留在原檔。

成果：FreeCheckup.jsx 再少 ~150 行，總計約從 7,200 → ~6,500。

---

## 不會動到的東西（明確列出）

- 任何 JSX 結構、className、`fontSize`、`<style>` 內 CSS 文字
- `holdingsTokens.js`、`DESIGN_SPEC.md`、配色憲法
- `holdings/` 目錄樣板元件的 import 規則（仍禁止 import 進 FreeCheckup）
- Hero `≤560/≤380px` media-query 內容
- 任何資料 / API / 同步 / quota 邏輯

## 驗證（強制全跑，依 Core「不准偷懶」條款）

1. `bunx vitest run`（全測試套件）
2. `bunx vitest run src/test/unit/freecheckup-i18n.test.ts`
3. `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts`
4. `node scripts/check-freecheckup-rwd.mjs`（560/390/380 三斷點靜態檢查）
5. `bunx playwright test e2e/freecheckup-card.spec.ts`
6. 視覺：preview 在 560 / 390 / 380 / 979 四個斷點各截圖一張，確認 Hero、`.wb-card`、各 Tab 與 Step 1 對齊。

任何一項失敗 → 回滾搬家後檢查 CSS template literal 是否被 `${}` 反引號逸出問題影響（這是搬家最容易踩的雷）。

## 風險

- **唯一真實風險**：`<style>{`...`}</style>` 內若有 `${C.textMute}` 之類的模板字串內插，搬到 `.ts` 後會失效（因為 C 不在那個檔的 scope）。處理方式：搬之前 grep `\${` 在 style 區塊內出現次數，若有，改成把整段 CSS 改回 function `buildGlobalCss(C)` 形式 export，FreeCheckup.jsx 端 `<style>{buildGlobalCss(C)}</style>`。我會在實作第一步先驗這點。

## 預期產出

- `src/pages/FreeCheckup.styles.ts`（新檔，純字串或單一 builder function）
- `src/checkup/hooks/useFreeCheckupClock.js`（新檔）
- `src/checkup/hooks/useFreeCheckupRetry.js`（新檔）
- `src/pages/FreeCheckup.jsx`（少 ~700 行、加 region 註解、import 上述三個新檔）

不更新記憶（憲法不變）。
