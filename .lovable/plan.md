# C 系列（CRITICAL 11 項）修復計畫

## 關於 C1 後台權限的回答

**會看得到，不受影響。** C1 的修法只擋「`expertId` 為 undefined 就不查」這個漏洞。
後台 (company / admin) 看任何專家持倉時，都是**明確帶 `expertId` 參數**進 `useMyHoldings(expertId)`，hook 內會 `.eq('expert_id', expertId)`，所以後台一樣完整可見。
真正被擋掉的只有「呼叫時忘了帶 ID → 回傳所有人 open 部位」這種洩漏路徑。

修完後我會 grep 全站 `useMyHoldings(` 呼叫點，確認後台頁面（如 `company/Analysts.tsx`、`admin/*`）都有正確帶入，不會誤擋。

---

## 修復順序與內容

### Batch A — 資料安全與崩潰防護（C1 / C2 / C11）
- **C1** `src/hooks/useMyTradeRecordHoldings.ts`
  - 加 `enabled: !!expertId`
  - 移除 `if (expertId)` 條件分支，改成「沒 ID 就不查」
- **C2** `src/checkup/stores/holdingsStore.js`
  - `setHoldings` 等 setter 在 functional update 時，若 `prev == null` 直接 `return prev`，避免破壞 hydration sentinel
- **C11** Holdings 渲染端
  - `globalPriorityList?.map(...)`、`sorted?.slice(0,12) ?? []` 加防呆預設值

### Batch B — Rules of Hooks（C3）
- `HoldingsTab.jsx`：`useCheckupMode()` 移至元件頂層，預設 `{ isDemo: false }`

### Batch C — 計算正確性（C5 / C6 / C9）
- **C5** 定位佔比分母改為 `posTotal`（該持倉小計），非 `indTotal`（產業總和）
- **C6** `useRouteHoldingsPage.js` + `holdings.js`
  - `totalCost` / `totalVal` / pnl 聚合**排除 `integrityIssue === 'missing-price'`**
  - 同時擴充 `buildHoldingPriceHints`：補上「最近一次收盤價」fallback 來源（從 `analysis_history` + `stock_prices` 表 / Edge function），讓缺價持倉盡量拿到價，治本
- **C9** `shouldAdoptCloudHoldings` 比較鍵加上 `alert` 與 `targetPrice`

### Batch D — 行動版 RWD（C8 / C10）
- **C8** HoldingCard 的 ROI class 名稱與 `<style>` block 對齊（`wb-card-pnl-num` / `wb-roi` 兩個都加上）
- **C10** ROI 字級從 `fontSize: 32` 改為 `clamp(18px, 4vw, 22px)` + `≤560px` / `≤380px` media query

### C4 / C7 — 不改
- C4 灰跌色為刻意設計，保留
- C7 demo 顯示一次收盤分析為產品設計，保留

---

## 驗證（每個 batch 修完跑一次）

1. `bunx vitest run src/test/unit/1.3-holding-math.test.ts src/test/unit/holdings-page.test.tsx src/test/unit/holdings-sort.test.ts src/test/unit/checkup-store-backed-hooks.test.tsx`
2. `bunx playwright test e2e/freecheckup-card.spec.ts`
3. `node scripts/check-freecheckup-rwd.mjs`
4. grep 確認後台 `useMyHoldings(` 全部有帶 `expertId`
5. 手動 QA（preview）：
   - `/holding-checkup` 390/560/768 三斷點檢視 ROI 不溢出
   - 持倉看板有缺價標的時，總報酬率不再被汙染
   - 修改 alert / targetPrice 後雲端同步會觸發

驗證有任何一條紅，就回到對應 batch 補修，不放行下一批。

---

## 技術細節（給工程參考）

- C2 setter 範例：
  ```js
  const makeSetter = (key) => (set) => (next) =>
    set((state) => {
      if (typeof next !== 'function') return { [key]: next }
      const prev = state[key]
      if (prev == null) return {} // sentinel 保護
      return { [key]: next(prev) }
    })
  ```
- C6 聚合範例：
  ```js
  const valid = holdings.filter(h => h.integrityIssue !== 'missing-price')
  const totalVal  = valid.reduce((s,h) => s + (h.value||0), 0)
  const totalCost = valid.reduce((s,h) => s + (Number(h.cost)||0)*(Number(h.qty)||0), 0)
  ```
- C6 補價來源優先序：`quotes` → `priceHints(analysis_history)` → 新增 `stock_prices` 表最近收盤 → `item.price`
