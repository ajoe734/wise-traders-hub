# 修復 /holding-checkup demo 首屏看不到看板（修訂版）

## 根因（已實機驗證）

`https://legendflow.tw/holding-checkup`（未登入）首屏由上而下：
1. `HoldingsIntroVideo` 720×405 大影片卡 + autoplay — `FreeCheckup.jsx:2815`
2. `DemoBanner` 完整版（兩行說明 + 兩顆登入鈕 + 收合鈕）— L2818
3. 返回列（sticky）— L2830
4. 看板標題列
5. `CoachMarks` 置中 modal STEP 1/3 — L2971

`TODAY'S P&L +11,624` 與 20 檔持倉卡被擠到 fold 下，CoachMarks 又遮住看板中央。資料注入正確（`useFreeCheckupBootstrap.js:96` `setHoldings(SEED_HOLDINGS)`），純版面問題。

## 變動範圍

只動四檔，不碰資料源：
- `src/checkup/components/HoldingsIntroVideo.jsx`
- `src/checkup/components/DemoBanner.jsx`
- `src/checkup/components/CoachMarks.jsx`
- `src/pages/FreeCheckup.jsx`（僅 L2814–2827 渲染順序）
- 新增 `e2e/freecheckup-demo-first-fold.spec.ts`

**禁動**：`useFreeCheckupBootstrap.js` demo 分支、`seedData.js` `INIT_HOLDINGS`、`demoData.js`、任何持倉資料內容。

## 1. `HoldingsIntroVideo` — 折疊預設 + 不渲染 video

- 預設 `show=false` → 渲染一條 36px 高的迷你入口列：`▶ 30 秒看懂持倉看板`（按鈕）+ 「不再顯示 ✕」次按鈕
- **折疊狀態完全不掛載 `<video>` 元素**（no preload、no autoplay、no src），DOM 內 `video` selector 必須回 0
- 點主按鈕 → `setExpanded(true)` 才條件渲染 `<video autoPlay muted playsInline loop controls>`
- 點「不再顯示」→ `localStorage.setItem('holdings-intro-video-seen-v2','1')` + 整塊隱藏；下次回訪保持隱藏
- 已選擇不再顯示的舊使用者（localStorage 已有 flag）→ 入口列也不渲染
- localStorage key 不變

## 2. `DemoBanner` — 緊湊化（不改文案、不移除）

- 桌機 padding 由 `12px 16px` → `8px 14px`；行高 1.5；按鈕 padding `5px 10px` / fontSize 11；間距 `gap: 6px`
- 手機（`max-width: 560px`）：兩行說明文字仍保留，但按鈕列改 `flex-wrap: wrap` 且 padding `6px 12px`；整體 banner 目標高度桌機 ≤ 56px、手機 ≤ 88px
- 收合鈕「×」位置保留
- 文案、按鈕文字、`stale` 警示、`onLineLogin` / `onEmailLogin` 行為一律不動
- 寫測試斷言：`getBoundingClientRect().height` 桌機 ≤ 60、手機 ≤ 96

## 3. `CoachMarks` — demo 延後 + 不可閃現

- 元件內讀 `useCheckupMode()` 取 `isDemo`、`isReady`
- 初始 `shouldShow = null`（未決定，render null）→ 等 `isReady === true` 後再決策，避免 mount 瞬間先出現再消失
- 決策：
  - `isDemo === false`：維持原行為——若 localStorage 無 `checkup-coach-seen-v1` → 立即顯示
  - `isDemo === true`：首屏不顯示。掛 `window` `scroll` 監聽（threshold > 200px）＋ 對 `onTabChange` prop 包一層 `triggerOnceThenShow`。任一觸發 → 顯示一次
- **cleanup**：
  - 觸發後立刻 `removeEventListener('scroll', ...)` 並把 `triggered` ref 設 true
  - `useEffect` cleanup 也 removeEventListener，避免 unmount 後遺留
  - 用 `passive: true` 避免 scroll 卡頓
- localStorage key 不變；非 demo 路徑零行為差異

## 4. `FreeCheckup.jsx` 渲染順序（L2814–2827）

```
DemoBanner（僅 demo, sticky）
Back bar（sticky）
持倉看板核心：TODAY'S P&L / HOLDINGS / ACTION PRIORITY / 20 檔卡
HoldingsIntroVideo（折疊入口）  ← 從 L2815 移到看板之後
CoachMarks（延後/或原行為，視 isDemo）
```

## 5. 驗收（必跑全部，不准漏）

### 新增 `e2e/freecheckup-demo-first-fold.spec.ts`

用 `locator.boundingBox()` + `expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)` 驗證在首屏內，**不只截圖**。

**Desktop 1280×800（未登入 demo）**：
- `text=TODAY'S P&L` boundingBox 在 viewport 內
- `text=+11,624` 可見且在 viewport 內
- 至少 1 張持倉卡（`text=/00637L|2330|2313/`）boundingBox 在 viewport 內
- `locator('video').count()` === 0
- `text=30 秒看懂持倉看板` 折疊入口可見
- CoachMarks modal（`text=/STEP \d \/ 3/` 或 `text=上傳成交` modal 容器）不可見

**Mobile 390×844（未登入 demo）**：
- 同上四項可見性檢查
- `DemoBanner` `boundingBox().height` ≤ 96
- 持倉卡 top 座標 < 844（未被擠出首屏）

**互動測試**：
- 點「30 秒看懂持倉看板」→ `locator('video').count()` 由 0 變 1，且 `autoplay` attr 存在
- demo + scroll 250px → CoachMarks 出現；再 scroll 不重複彈
- demo + 切 tab（不 scroll）→ CoachMarks 出現；切第二次不重複彈

**已登入路徑（mock supabase session）**：
- CoachMarks mount 即彈（不需要 scroll）
- 影片入口同樣折疊

### 既有測試一律跑過
- `bunx playwright test e2e/freecheckup-card.spec.ts e2e/freecheckup-demo-first-fold.spec.ts`
- `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts src/test/unit/freecheckup-tab-perf.test.tsx src/test/unit/freecheckup-tab-prop-schema.test.ts src/test/unit/freecheckup-i18n.test.ts src/test/unit/daily-tab-line-free-copy.test.tsx`

## 回報格式（執行後）

1. 實際改動檔案清單（含行數）
2. Desktop 1280×800 首屏：各元素 boundingBox 數值 + 截圖
3. Mobile 390×844 首屏：同上 + DemoBanner 實測高度
4. CoachMarks demo / 非 demo 行為對照（兩段 Playwright log）
5. 影片折疊時 `locator('video').count()` 實測值
6. 全部測試結果（pass/fail 數）
