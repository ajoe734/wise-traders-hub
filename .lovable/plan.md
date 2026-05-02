# Phase 6: 持倉看板全面優化 (P1–P12)

## 範圍

`/free-checkup` 內 `FreeCheckup.jsx` 第 ~1525–4660 行的 inline 持倉看板（header / 篩選 / `wb-card` 卡片牆 / Detail Panel / 空狀態 / RWD CSS），以及背後 `decisionsMap`、`orderedDisplayed`、`renderCard`、`renderDetailPanel`、sparkline 載入。

**遵守不變**：
- inline 渲染共識（`mem://architecture/checkup/inline-rendering-audit`）— 不抽元件
- 單色橘 + 灰 PnL 憲法（`mem://style/holdings/monochrome-orange-pnl`）
- Kore-eda 極簡風 / YYYY/MM/DD 日期 / 字級≥32 三斷點規則

## 變更清單

### 必修（P1–P5）

**P1+P12 — `decisionsMap` 與 memo 依賴重構**  
`decisionsMap` 目前依賴 `H`（陣列），每次 TWSE 報價刷新 `H` 是新陣列 → 整表重算 → 帶動 `globalSortedList` / `displayed` / `orderedDisplayed` 全部重算。但 `buildDecision(code, events, overrides, now)` 不看報價，所以改成依賴已存在的 `holdingsCodesKey`（穩定字串），報價變動不再重算決策。預計 30+ 持倉 re-render 量 -50%。

**P2 — 移除 `__featureSlot` 注入**  
`orderedDisplayed.map(h => ({ ...h, __featureSlot }))` 每次 spread 出新物件破壞引用相等。改成 `renderCard(h, idx)`，由 `idx === 0 && firstVariant === 'ink'` 在函式內判斷。

**P3 — Sparkline 失敗回饋**  
新增 `sparklineErrors` state，`callEdge('checkup-sparkline')` 失敗時記錄。`sparkData < 2` 時：有 error 顯示 `~`（title="歷史價尚未同步，稍後重試"），無 error 維持 `———`（無資料）。

**P4 — `wb-card` a11y**  
- 卡片 `<button>` 加 `aria-label="${name} ${code}, 報酬率 ${pct}%, 損益 ${pnl}"`
- 加 `aria-pressed={isActive}` 表達展開狀態
- `onDoubleClick → openHoldingDrawer` 加鍵盤替代：Shift+Enter 開 drawer
- Detail Panel 上下/關閉鍵的 button 補 `aria-label`

**P5 — `cardSpec` 抽參（不抽元件）**  
feature/normal 兩段 90% 重複的 L1–L5 五層渲染合併。維持單一 `renderCard`，但用：
```js
const SPEC = isFeatureCard ? FEATURE_SPEC : NORMAL_SPEC;
// FEATURE_SPEC = { padding:'24px 28px 20px', sparkW:60, roiClamp:'clamp(40px, 6vw + 12px, 64px)', textLimit:90, ... }
```
仍 inline 渲染，但欄位調整只改一處。

### 建議（P6–P10）

**P6 — 排序穩定 tiebreaker**  
`compareByPriority` 末段加 `a.code.localeCompare(b.code)` 確保並列時順序穩定。

**P7 — `featureSlot` 條件**  
只在 `idx === 0 && variantsMap.get(h.code) === 'ink'` 時當 feature；否則不掛此標記（搭配 P2 一起處理）。

**P8 — `actionText` 智慧斷句**  
取代硬切 `slice(0, 88) + '…'`：先在限制長度範圍內找最後一個標點（。、，；！？），找到就斷在該處；找不到才退回硬切。中文體驗顯著提升。

**P9 — 篩選空集獨立空狀態**  
4266 行 `orderedDisplayed.length === 0` 拆兩種：
- `H.length === 0` → 維持現有「上傳成交」3 步教學卡
- 否則（篩選/搜尋無結果）→ 顯示「沒有符合條件的持倉」+「清除所有篩選」CTA

**P10 — feature 卡補 `srcLabel` 報價來源徽章**  
normal 卡（4012 行）有 `screenshot/live/yclose` 徽章，feature 卡缺。在 feature L5 區塊 VALUE 旁同樣加上，配色改用 `rgba(244,241,236,0.x)` 適配黑底。

### 可選（P11）

**P11 — CSS 變數化**  
`.wb-card .wb-roi`、`.wb-card-feature .wb-roi`、`.wb-bottom-val` 在 `≤640 / ≤560 / ≤390 / ≤380` 四層斷點重複宣告 font-size。改用 `--roi-size` / `--roi-size-feature` / `--bottom-val-size` 三個變數，斷點只改變數值。需同步更新 `freecheckup-mobile-card-overflow.test.ts`（grep 字串改成讀變數定義 + 變數使用）。

## 不做

- 不抽元件到 `src/checkup/components/holdings/*`
- 不改 `buildDecision` 邏輯
- 不改紅綠/橘灰配色憲法
- 不動 `HoldingsPanel/Table` 樣板

## 驗證（每階段必跑）

1. `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts`
2. `bunx vitest run src/test/unit/freecheckup-i18n.test.ts`
3. `bunx vitest run`（全 740+ 測試回歸）
4. `node scripts/check-freecheckup-rwd.mjs`（560/390/380 三斷點靜態檢查）
5. `bunx playwright test e2e/freecheckup-card.spec.ts`
6. 手機視覺截圖（依 `mem://qa/checkup/freecheckup-mobile-regression-checklist`）

## 執行順序（10 步，預期單一 loop 內完成）

1. P1 + P12 — decisionsMap 依賴改 `holdingsCodesKey`
2. P2 + P7 — 移除 `__featureSlot`，改 `renderCard(h, idx)` + 條件判斷
3. P3 — sparklineErrors state + UI 區分
4. P9 — 篩選空集獨立 UI
5. P4 — aria-label / aria-pressed / 鍵盤替代
6. P10 — feature 卡 srcLabel
7. P6 — 排序 tiebreaker
8. P8 — actionText 智慧斷句
9. P5 — cardSpec 抽參
10. P11 — CSS 變數化（最後做，因會動測試）
11. RWD + i18n + 全測試回歸
