## 持倉看板剩餘 TDD 收尾（整合成新 doc）

新增 `docs/architecture/holdings-consistency-tdd.md` 作為單一事實來源，涵蓋兩塊未完成事項並以 TDD 執行；完成後把該 doc 併回 `holdings-modules.md` 的「已完成」清單。

### 待整合的剩餘工作（已窮舉先前提案）

| # | 項目 | 前次狀態 | 為何要做 |
|---|---|---|---|
| A | Shell Event Bus **deep-link 消費端** | URL 已寫入 `?expand=` / `?stock=` / `?topic=`（`ShellEventBusProvider.tsx` L80-115），**但 `useRouteHoldingsPage`、`useRouteDailyPage`、`useRouteResearchPage` 沒有讀 `useSearchParams`**，事件跳頁後抽屜/預填不會展開 | 契約半殘：E2E 只 assert URL，功能實際壞掉 |
| B | **Skeleton / Loading 一致性** | HoldingCardSkeleton ✅、HoldingsPage fallback = 純文字、EventsPanel `PredictionSkeleton` 用了不存在的 `pulse` keyframes、ChipsSection = 純文字、DailyReportPanel = 無 loading UI、CSS 存在 `shimmer` + `holdingsSkeletonShimmer` 兩套 keyframes | 切模組閃白、跳版、動畫壞掉 |

（Phase L2-3 執行後仍有 374 檔 `missing_snapshot` — 屬 data-ops，非 UI 一致性範圍，本 doc 不含，改由排程 cron 每日自然收斂。）

---

### 新 doc 骨架

```
docs/architecture/holdings-consistency-tdd.md
  §1 背景 & 目標（把上表兩項寫入）
  §2 契約
     §2.A Deep-link URL → store 契約表
     §2.B CheckupSkeleton 元件契約（props / 動畫 token / a11y）
  §3 測試策略（TDD 分層）
  §4 實作步驟（A1-A3, B1-B6）
  §5 執行日誌（勾選 checkbox + 測試輸出）
  §6 完成標記
```

---

### A · Deep-link 消費端（TDD）

**契約**

| 觸發事件 | URL 落點 | 消費 hook | 副作用 |
|---|---|---|---|
| `holdings:focus` | `/portfolio/:id/holdings?expand=<code>` | `useRouteHoldingsPage` | `brainStore.setExpandedStock(code)` + 滾動至該卡 |
| `closing:openStock` | `/portfolio/:id/daily?stock=<code>[&date=…]` | `useRouteDailyPage` | `brainStore.setExpandedStock(code)` + 若有 date 寫入 `reportsStore.selectedDate` |
| `research:prefill` | `/portfolio/:id/research?stock=<code>[&topic=…]` | `useRouteResearchPage` | `researchStore.prefill({stockCode, topic})` |

**測試**
- L2 unit：`checkup-route-hooks.test.tsx` 針對三個 hook 各加 `it`，用 `MemoryRouter` 帶 query string，assert store setter 被呼叫。
- L5 E2E：擴充 `e2e/shell-event-bus-nav-v2.spec.ts` — emit `holdings:focus` 後不僅 assert URL，還 assert `[data-testid="holding-card"][data-expanded="true"]` 存在。

**實作步驟**
1. A1 — 三個 route hook 加 `useSearchParams()`，`useEffect` 同步 param → store。
2. A2 — `HoldingCard.tsx` 依 `expandedStock === h.code` 加 `data-expanded` 屬性（供 E2E 觀測）。
3. A3 — 補 unit + E2E 斷言。

---

### B · Skeleton / Loading 一致性（TDD）

**契約：新增 `src/checkup/components/_ui/CheckupSkeleton.tsx`**
- Props：`width`, `height`, `variant='normal'|'ink'`, `radius=0`
- 動畫統一走 `@keyframes shimmer`（`src/index.css:756`，1.4s ease-in-out）
- 色 token：`normal → alpha(WB.ink,'08')`，`ink → rgba(244,241,236,0.10)`
- 一律 `aria-hidden="true"` + `data-testid="checkup-skeleton"`

**5 個消費點統一**

| 位置 | 前狀態 | 改為 |
|---|---|---|
| `HoldingsPage.jsx` Suspense fallback | 純文字「持倉載入中…」 | 4 張 `HoldingCardSkeleton` grid |
| `EventsPanel.PredictionSkeleton` | 壞掉的 `pulse` animation | 兩條 `CheckupSkeleton` |
| `ChipsSection` loading | 純文字「載入中…」 | 表頭 + 5 列 `CheckupSkeleton`，保留 `data-testid="chips-loading"` |
| `DailyReportPanel` 首次載入 | 無 UI | 標題 + 3 列區塊骨架 |
| `holdingsTab.css` `holdingsSkeletonShimmer` | 獨立 keyframes | 遷移到 `shimmer`，刪除舊 keyframes |

**測試**
- L2 unit：`CheckupSkeleton.test.tsx` 驗 render、aria、variant 色差。
- 視覺回歸：Playwright 三斷點（560/390/380）截圖切換 tab 無白閃，`bunx playwright test e2e/freecheckup-tabs-visual.spec.ts`。
- 動畫存活斷言：`e2e/holdings-loading-skeleton.spec.ts`（新增），attach 到 loading DOM 上讀取 `animation-name` = `shimmer`。

**實作步驟**
- B1 建 `CheckupSkeleton.tsx`
- B2 改 `HoldingsPage.jsx` fallback
- B3 改 `PredictionSkeleton`
- B4 改 `ChipsSection` loading 區塊
- B5 加 `DailyReportPanel` loading 骨架
- B6 刪除 `holdingsSkeletonShimmer` keyframes，遷移使用點到 `shimmer`

---

### 驗收（doc §5 執行日誌會逐項勾）

- `bunx tsgo --noEmit`
- `bunx vitest run src/test/unit/checkup-route-hooks.test.tsx src/test/components` 綠燈
- `bunx playwright test e2e/shell-event-bus-nav-v2.spec.ts e2e/freecheckup-tabs-visual.spec.ts e2e/holdings-loading-skeleton.spec.ts` 綠燈

### 完成後

在 `docs/architecture/holdings-modules.md` §「TODO（歷史記錄）」加一條：
> ~~Deep-link 消費 + Skeleton 一致性~~ ✅ 見 `holdings-consistency-tdd.md`。

新 doc 進入維護模式（不刪除，作為未來擴充事件/loading 的套版）。
