# A2 — 拆 Tab Component + 修改 Inline Rendering 憲法

## 為什麼要拆
A2 子項（每個 tab JSX 包 `useMemo` / inline list `React.memo`）**無法只在 inline JSX 內安全完成**：
- `useMemo(() => <JSX/>, [deps])` 內聯方式可行，但 4 個 tab 各自 600~1500 行、依賴 50+ 變數，deps 陣列無法人工維護，漏一個就 stale render，加多了等同沒 memo。
- inline list 的 `.map(item => <div .../>)` 必須掛 `React.memo` 才能避免父層 setState 連帶重繪整個列表，而 `React.memo` 必須是有名稱的 function component，不能寫在 render body 內。
- 因此拆元件是必要條件。

## 硬合約（不能動）
1. `L2965` 全域 `<style>{...}</style>` 字面字串
2. `L4745` 持倉看板 `<style>{...}</style>` 字面字串
   - `freecheckup-mobile-card-overflow.test.ts` 用 regex 掃這兩段，**必須留在 `FreeCheckup.jsx`**
3. 抽出的 sub-component 必須與父層共用 `C / alpha / theme`、可接收所有現有 callback / state 為 props，不得引入新 state owner

## Phase 規劃（由低風險到高風險）

### Phase A2-1 — 抽 inline list item（風險低、收益最大）
僅抽 list 列項目元件，**不動 tab 容器**：
- `<EventCard>` （events tab map 的單張卡）→ memo
- `<NewsCard>` （news tab map 的單張卡）→ memo
- `<DailyHistoryItem>` （daily tab analysisHistory map）→ memo

放置：`src/checkup/components/freecheckup/` 新目錄（與 holdings/ 並列），維持 inline JSX 不外移、僅 list item memo 化。

### Phase A2-2 — Holdings tab 用 useMemo 包 JSX（最重要分頁，改善打字延遲）
Holdings tab 已有 `deferredSearchQ`，再把 tab 內整段 `<>...</>` 用 `useMemo(() => <>...</>, [...stable refs + deferredSearchQ + filteredSortedList])` 包住。
- deps 限定純資料（不放 callback，callback 已在 Phase 2 ref 化）
- 不抽元件，只在原地包 useMemo（inline 仍成立）

### Phase A2-3 — Events / News / Daily tab JSX 用 useMemo 包
同 A2-2 做法，原地 `useMemo` 不外移。

### Phase A2-4 — 修憲
更新 `mem://architecture/checkup/inline-rendering-audit`：
- **新增例外條款**：允許 `src/checkup/components/freecheckup/` 下 list item 級別的 memo wrapper，但 tab 容器級 JSX **仍必須留在 `FreeCheckup.jsx`**。
- 強調 L2965 / L4745 `<style>` 字面字串不變。
- 補一條：tab JSX 可用 inline `useMemo` 包，但 deps 必須是 stable ref + deferred value，禁止把 callback 放進 deps。

## 驗證
每個 phase 結束跑：
1. `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts`
2. `bunx vitest run src/test/unit/freecheckup-i18n.test.ts`
3. 視覺檢查 560 / 390 / 380px 三斷點（依 mobile regression checklist）
4. 手動點 4 個 tab 切換 + 搜尋打字 + 展開 list item 不卡頓

## 本輪先做
**只做 Phase A2-1**（抽三個 list item memo wrapper），跑測試確認綠燈。後續 phase 等使用者下一個指令。

理由：3300 行 JSX 一次全動風險過高，list item memo 已能解決「父層 setState 重繪整個列表」這個最痛的點，可立即驗收效果再決定是否續推。