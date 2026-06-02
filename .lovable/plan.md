# H 系列（HIGH 17 項）修復計畫

## 修復分批

### Batch A — 數字正確性（H1 / H2 / H6 / H7 / H8 / H9 / H17）

集中收斂到 **3 個檔案**，避免散點補丁：

1. **`src/checkup/lib/holdingMath.ts`**
   - 新增 `toSafeNumber(v, fallback=0)`：`Number(v)` → `isFinite` → fallback，吸收 string/null/undefined（解 **H1 NaN**）
   - 所有 `calculateHolding*` 函式內部一律走 `toSafeNumber`，禁止裸 `Number()` 減法
   - `calculateHoldingReturnPct`：`costBasis <= 0` 已 return 0，補上 `!isFinite(costBasis)` 防呆（解 **H7 cost=0 Infinity**）

2. **`src/checkup/lib/holdings.js`**
   - `getHoldingUnrealizedPnl` / `getHoldingReturnPct` 內目前「有 item.pnl 就直接用」是 fallback 來源不一致的根（**H6**）。改：先檢查 `item.totalCost && item.fee` 走精確模式 `calcPnlWithNet`；否則才走 `(price-cost)*qty`，**唯一公式入口**
   - `applyTradeEntryToHoldings` 賣出分支：呼叫 `calcRemainingCostAfterPartialSell` 同步縮減 `totalCost` / `fee`，避免「老 leg 殘留」總成本重複計（**H8**）
   - 排序輔助 `sortHoldingsByPnl/Return`：`||` → `??`（**H2**）

3. **`src/checkup/stores/holdingsStore.js`**
   - `getTopGainers/Losers`：`(b.pct || 0)` → `(b.pct ?? 0)`（**H2**）
   - `getHoldingsSummary`：同樣 `||` → `??`，並改用 `lib/holdings` 的 aggregation helper 統一公式（**H6** 連鎖）
   - `upsertHolding` 入口驗證（**H17**）：
     ```js
     const code = String(holding?.code || '').trim();
     const qty = Number(holding?.qty);
     if (!code || !Number.isFinite(qty) || qty <= 0) return state; // no-op
     const price = Math.max(0, Number(holding?.price) || 0);
     ```
   - **H9** map 殘留：`removeHolding` 已用 filter 正確，但 `applyTradeEntryToHoldings` 全部賣出後要從陣列 splice（目前 lib 已做，需在 store `upsertHolding` path 也對齊：qty=0 = remove）

### Batch B — Analytics 三缺口（H3 / H4 / H5）

集中在 `src/lib/analytics/events.ts` 新增三個 event，並補打點：

1. **H3 — `checkup_holdings_sort_change`**
   - 加事件型別到 events.ts
   - `HoldingsTab.tsx` L267-289 排序按鈕 onClick 內 `track('checkup_holdings_sort_change', { sortBy, sortDir })`

2. **H4 — filter / toggle 事件**
   - `HoldingsFilterBar` 內 6 個 setFilter* 與 toggleSetItem 統一封裝為 `useTrackedFilter`，發送 `checkup_holdings_filter_change`

3. **H5 — `onUpdateTarget` / `onUpdateAlert` 落地**
   - `HoldingsTable.jsx` L55-60 的 callback 內補 `track('checkup_holding_target_set' / '_alert_set', { code })`
   - `usePortfolioPanelsContextComposer.js` L247-248 的 wrapper 同步打點（cover 卡片版入口）

### Batch C — 效能 + 穩定性（H10 / H11 / H12 / H13 / H14 / H15 / H16）✅ 2026-06-02 完成

1. **H11 ✅** `useRouteHoldingsPage.js` 改用 `holdingsRawRef` 暫存最新 raw，memo deps 只看 `holdingsValueKey`，移除唯一一處 `eslint-disable react-hooks/exhaustive-deps`
2. **H12 ✅** `useHoldingsDerivations.js` `safeDecisionsMap` / `safeStockMeta` / `safeGlobalPriorityList` 改 `useMemo`，下游 `variantsMap` / `actionPriorityItems` 不再每 render 失效
3. **H13 ✅** `holdingsValueKeyShort` / `holdingsValueKeyFull` 加上 `n=<length>:` 前綴，避免分隔符碰撞；test fixture 同步更新
4. **H14 ✅** 已於 2026-06-02 立 [統一憲法](mem://style/holdings/h14-urgency-constitution) + CI guard
5. **H15 ✅** `holdingsStore` `getTopGainers` / `getTopLosers` / `getTop5` / `getHoldingsSummary` 改 WeakMap-by-array-ref 快取，store 沒換陣列 → 回同份結果
6. **H16 ✅** 全檔 grep 確認 `HoldingsTab.tsx` 內無任何 `useEffect`/`useRef`；H11 已消除唯一 eslint-disable，無遺漏
7. **H10 ✅** `HoldingsPage.jsx` 改用 `ErrorBoundary` 包裝 + `Suspense` fallback，捕捉 render 期錯誤；class boundary 已存在於 `src/checkup/components/ErrorBoundary.jsx`，重用而非新建

驗證：
- `vitest`：8 files / 116 tests 全綠（含新增 `holdings-batch-c-regression.test.tsx`）
- `node scripts/check-freecheckup-rwd.mjs`：靜態檢查通過
- `bunx playwright test e2e/freecheckup-card.spec.ts`：12/12 通過

---

## 驗證流程（每批跑一次，全紅才放行下一批）

```bash
bunx vitest run src/test/unit/1.3-holding-math.test.ts \
                src/test/unit/holdings-page.test.tsx \
                src/test/unit/holdings-sort.test.ts \
                src/test/unit/checkup-store-backed-hooks.test.tsx
bunx playwright test e2e/freecheckup-card.spec.ts
node scripts/check-freecheckup-rwd.mjs
```

新增測試（鎖死回歸）：
- `holding-math.test.ts`：`toSafeNumber('5.2')`、`null`、`undefined`、`NaN`、`'abc'` → 正確 fallback；`pnl(cost=0)` → 0 而非 Infinity；`pnl(qty='100')` → 正確
- `holdings-sort.test.ts`：`URGENCY_RANK` 三值排序、`pct=0` 不被當缺值
- 新增 `holdings-store.test.ts`：`upsertHolding({qty:0})` no-op、`upsertHolding({code:''})` no-op、partial sale 後 `totalCost` 等比例縮減
- 新增 `holdings-analytics.test.ts`：mock `track`，斷言 sort / filter / target / alert 點擊各觸發一次

---

## 5 輪自我檢討（一勞永逸防回歸）

### 第 1 輪 — 「補丁是否變成新地雷？」
- ❌ `||→??` 散落 10+ 處：每次改都要記得，未來必回歸
  - ✅ 修法：寫 ESLint custom rule `no-or-zero-on-pct`（或用 `no-restricted-syntax` 樣板）禁止 `pct || ` / `pnl || `，CI 擋下
- ❌ `Number()` 裸用同理
  - ✅ 強制走 `toSafeNumber`，加 ESLint 禁 `holdings.js` / `holdingMath.ts` 以外檔案直接 `Number(item.qty|cost|price|pct|pnl)`

### 第 2 輪 — 「公式真的只剩一處嗎？」
- 目前 PnL 算法散在：`holdings.js`、`holdingMath.ts`、`holdingsStore` selector、`HoldingsHero` props 預算、`useRouteHoldingsPage` aggregate、`HoldingCard` 顯示時 fallback
- ✅ 規約：**所有 pnl/pct/value 必經 `holdingMath.ts` 函式**；其它檔案 import，禁止再寫 `(price-cost)*qty`
- ✅ 加 grep gate：`scripts/check-holdings-formula-singleton.mjs`，掃描 `*qty.*-.*cost|cost.*\*.*qty` 字面 pattern，白名單只放 `holdingMath.ts`，CI 跑

### 第 3 輪 — 「Analytics 缺口會不會再次出現？」
- 根因：track 是 fire-and-forget，沒回呼，漏寫無人知
- ✅ 在 `src/lib/analytics/events.ts` 定義 `HoldingsEventMap` discriminated union；
- ✅ `HoldingsTab` / `HoldingsFilterBar` / `HoldingsTable` 三個檔案頂端各放 `// @analytics-required: sort_change, filter_change, target_set, alert_set` 註解 + 對應 unit test 透過 fast-glob 掃註解 → 確保註解列出的事件名稱實際被 import/呼叫
- ✅ 一旦未來新增 filter 維度，TypeScript event payload 缺欄位會編譯失敗

### 第 4 輪 — 「memo / deps 漏洞還有沒有？」
- 風險清單（這次審計外）：
  - `useHoldingsDerivations` 其餘 5 個 useMemo
  - `HoldingsTab` 內 `cardGridCols` (已 OK)、`renderCard` 非 memo（每次 new fn，但傳入 memo 子元件無影響因 HoldingCard 用 React.memo + dep 比較）
  - `useRouteHoldingsPage` return 物件每次新建（已用 useMemo 包，OK）
- ✅ 動作：開啟 `react-hooks/exhaustive-deps` 為 **error** 等級（目前是 warn），全部 eslint-disable 註解要附 PR 連結+理由
- ✅ 補 React DevTools Profiler 截圖規範：每次改 HoldingsTab 必貼「同樣操作 commit 數對比」

### 第 5 輪 — 「ErrorBoundary 真的接得住嗎？」
- 風險：ErrorBoundary 只接 render 期，event handler / async 不接
- ✅ `HoldingsErrorBoundary` 接 render 期錯誤
- ✅ `holdingsStore` setter 既有 try/catch 接 functional updater 拋錯
- ✅ 補 global `window.addEventListener('unhandledrejection', ...)` 在 `App.tsx`（若已有則覆寫白名單），把 holdings 相關 async 失敗上報
- ✅ 加 e2e：故意傳 `upsertHolding({code:null})`、`setHoldings(()=>{throw 1})`，斷言 UI 不變白屏

---

## 一勞永逸護欄總表（修完後永久啟用）

| 護欄 | 阻擋 | 位置 |
|---|---|---|
| ESLint `no-or-zero-on-pct` | H2 回歸 | `eslint.config.js` |
| ESLint 禁裸 `Number(item.qty\|cost...)` | H1 回歸 | `eslint.config.js` |
| `check-holdings-formula-singleton.mjs` | H6 回歸 | CI |
| `URGENCY_RANK` 單一 export from `holdingsSort.ts` | H14 回歸 | grep gate |
| `react-hooks/exhaustive-deps: error` | H11/H12/H16 回歸 | `eslint.config.js` |
| `HoldingsEventMap` + `@analytics-required` 註解掃描 | H3/H4/H5 回歸 | unit test |
| `HoldingsErrorBoundary` + unhandledrejection | H10 回歸 | App 啟動 |
| `upsertHolding` 入口驗證 + unit test | H17 回歸 | store |

---

## 不在 H 系列範圍（保留現狀）
- C4 灰跌色（刻意設計）
- C7 demo 收盤分析顯示策略
- 後台 `useMyHoldings(expertId)` 路徑（C1 已驗證不受影響）

驗證任何一條紅 → 回到對應 batch 補修，不放行。完成後 mem 記錄「H 系列護欄憲法」。
