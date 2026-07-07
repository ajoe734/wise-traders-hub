## 持倉版全面 Bug 清掃報告

窮舉範圍：`src/checkup/components/freecheckup/Holdings*.tsx`、`HoldingsTab.tsx`、`HoldingsSectorSummary.tsx`、`HoldingsReversalSection.tsx`、`HoldingCard.tsx`、`HoldingsDetailPanel.tsx`、`useHoldingsDerivations` hook 呼叫路徑、`sectorFilterPresets` lib。

---

### 🔴 P0 — Critical

**Bug 1｜Rules of Hooks 違反（React crash）** — `HoldingsSectorSummary.tsx`
- L42：`if (!Array.isArray(holdings) || holdings.length === 0) return null`
- L55：`if (industryByValue.length === 0) return null`
- 這兩個 early return **在 12 個 `useState` / 2 個 `useEffect` / 2 個 `useRef` / `useSectorFilterPresets()` 之前**（hooks 群位於 L123–L152）。
- 症狀：使用者從「0 檔持倉」上傳第一筆 → hooks 數量從 0 跳到 15 → React 拋 `Rendered more hooks than during the previous render`，整個持倉頁白屏。
- 修正：所有 hook 呼叫上移至函式最頂端，early return 改在 hooks 之後。

---

### 🟠 P1 — 設計系統與品牌違反（記憶體規範 Core）

**Bug 2｜`C.teal` 藍綠色作為 active accent**（違反 Core：「no blue/green/purple accents」）
- `HoldingsSectorSummary.tsx` L560, L566, L588, L590, L633, L766, L781, L859, L870, L906
- 產業卡選中框、題材選中框、策略選中點、預設編輯框全部用 teal
- 修正：active 狀態統一改用 `C.text` + `alpha(C.text, '10~40')`；選中點/圓點改 `C.text`

**Bug 3｜`C.up`（漲=紅）誤用為錯誤色**（違反 Taiwan trading color 憲法）
- `HoldingsSectorSummary.tsx` L373, L375, L382, L392–394, L558, L564, L588, L590, L599, L609–611
- 「已存在同名預設」錯誤提示、highlight 動畫、「跳至該預設」按鈕全用 `C.up`
- 使用者會把「紅色高亮」誤認為「上漲提示」
- 修正：錯誤訊息改 `C.text` 深字 + `alpha(C.textMute, '30')` 虛線邊；highlight 改 `alpha(C.text, '10')`

**Bug 4｜DEMO 提示卡硬碼顏色** — `HoldingsTab.tsx` L215–216
- `background:"#06C755"` (LINE 綠) / `color:"#fff"` 直接寫死
- 違反：所有顏色必須是 semantic token
- 修正：抽出 `<LineLoginButton>` 使用 design token 或至少用專案已定義的 line brand token；白色改 `C.paper`

**Bug 5｜集中警示 badge 一視同仁** — `HoldingsSectorSummary.tsx` L732–746 + L810
- Badge 顯示條件是 `warnings.length > 0`，pct 20% 與 45% 都同一顆黑框
- 下方文字才用 `warnings.some(w => w.pct > 30)` 加「建議分散風險」
- 兩處判斷閾值不一致，使用者困惑「到底是不是嚴重」
- 修正：統一閾值（如 ≥30% 才顯示 badge，且文案／字重升級），或 badge 依最高 pct 分級

---

### 🟡 P2 — Prop schema / 資料流

**Bug 6｜`setTab` 在 schema 重複宣告** — `HoldingsTab.tsx` L37 & L58
- L37: `setTab: 'function'` (required)
- L58: `setTab: _opt('any')` (optional，覆蓋 L37)
- 結果：validateProps 對 `setTab` 完全失效，漏傳不會警告
- 修正：刪除 L58 重複宣告

**Bug 7｜`renderCard` 誤傳 `idx`** — `HoldingsTab.tsx` L421
- `orderedDisplayed.map((h, idx) => renderCard(h, idx))`
- 但 `renderCard = (h) => …` 只接一個參數
- 無害但誤導後續維護；修正為 `.map(renderCard)`

**Bug 8｜`sectorFilter` state 不跨 session 保存** — `HoldingsTab.tsx` L149
- 使用者切到「事件」再回「持倉」→ 已選的族群 chip 全部消失
- 與「篩選預設」功能設計精神矛盾（既然存得下預設，就該記得當下選擇）
- 修正：`sectorFilter` 存進 `brainStore` 或 sessionStorage（key `checkup:holdings:sectorFilter:v1`）

---

### 🟢 P3 — UX 細節

**Bug 9｜儲存預設時無即時重名偵測** — `HoldingsSectorSummary.tsx` L359–380
- 使用者要按下「儲存」才會被告知重名
- 修正：`onChange` 時就查 `presets.find(p => p.name.trim() === nameDraft.trim())`，即時顯示灰字提示

**Bug 10｜`confirm()` 阻塞式刪除** — L703 `window.confirm(...)`
- 專案其他地方走 shadcn AlertDialog；這裡混用原生 confirm 樣式突兀
- 修正：改用專案既有的 AlertDialog（若成本高可延後，優先度低）

---

## 修正計畫（分兩批 commit，可獨立驗證）

### Batch A — P0 + P1（必做，本次交付）
1. **`HoldingsSectorSummary.tsx` 重排 hook**：所有 `useState / useRef / useEffect / useSectorFilterPresets` 移至函式最頂端；early return 挪到 hooks 之後
2. **同檔全域顏色換色**：
   - active accent：`C.teal` → `C.text`；`alpha(C.teal, 'xx')` → `alpha(C.text, 'xx')`
   - 錯誤/衝突：`C.up` → `C.text` 搭配虛線 `alpha(C.textMute, '35')`
   - highlight：`alpha(C.up, '10/55')` → `alpha(C.text, '08/30')`
3. **`HoldingsTab.tsx` DEMO 卡去硬碼色**：改語意 token（LINE 按鈕沿用專案 `bg-line` 語意，若無則暫以 `C.text` 深底 + `C.paper` 字）
4. **集中警示閾值統一**：badge 與下方 tips 都以 `pct ≥ 30%` 為「建議分散」門檻；`20%–29%` 顯示為「留意」（灰字，不出 badge）

### Batch B — P2 + P3（同一 turn 內順帶）
5. **`HoldingsTab.tsx` schema 去重**：刪 L58 `setTab: _opt('any')`
6. **`HoldingsTab.tsx` L421**：`.map(renderCard)`
7. **`sectorFilter` 持久化**：sessionStorage 存取，掛載時 hydrate
8. **儲存預設即時重名提示**：`onChange` 檢查，錯誤變灰提示（不擋輸入）

### 驗證清單
- [ ] `bun run typecheck` 通過
- [ ] `bun run build` 通過
- [ ] `bunx vitest run src/test/sectorFilterPresets.test.ts` 通過
- [ ] `bunx playwright test e2e/freecheckup-demo-first-fold.spec.ts`
- [ ] Playwright 手動流程：0 檔 → 上傳第一檔（確認 P0 hook crash 已修）
- [ ] 手機 390px 截圖：確認顏色改動後 active 狀態仍可辨識
- [ ] 桌機截圖：族群卡、題材、策略、預設列的 hover / active / edit 狀態

## 不做 / 明確排除
- ❌ 不動 `HoldingCard.tsx`, `HoldingsDetailPanel.tsx`（本輪視覺不需重排；掃描未見致命 bug）
- ❌ 不改業務邏輯（`aggregateBySector`、`matchSectorCodes`、`useHoldingsDerivations` 演算法保持原樣）
- ❌ 不改 Reversal / FilterBar / Hero / QuotaMeter（同上）
- ❌ Bug 10（原生 confirm）延後，避免與本次視覺改動混雜

## 給非技術讀者的白話總結
1. 持倉族群區塊有一顆定時炸彈：使用者第一次上傳持倉時可能整頁白屏，先拆彈。
2. 這區塊塞了不少藍綠色與紅色錯誤提示，跟你要求的「純米色 + 台股紅漲綠跌」憲法衝突，全部換掉。
3. 集中警示的「嚴重／不嚴重」標準前後不一致，統一到 30%。
4. 順手修掉 4 個小維護坑（重複 schema、誤傳參數、篩選消失、重名要到儲存才知道）。
