## 修復目標
延續上輪「橘+灰單色憲法」，把對話過程中提過、但**還沒處理**的 4 個 BUG 與 1 個孤兒元件決議一次收尾。

---

## BUG 1：Freemium AI 用量限制補完
**問題**：記憶 `freemium-demo-strategy` 標記「事件、行事曆、收盤分析」三個 AI 觸發按鈕沒有套 `uploadCountToday` 的「LINE 用戶每日 1 次」限制，可被無限呼叫。

**檔案**：`src/pages/FreeCheckup.jsx`
**做法**：
1. 找出三個觸發按鈕（事件預測 `predictEvents`、行事曆刷新 `refreshCalendar`、收盤分析 `generateDailyReport`）的 onClick handler
2. 在 handler 開頭加上守門：
   ```js
   if (isLineUser && uploadCountToday >= 1) {
     toast({ title: '今日免費額度已用完', desc: '訂閱後可解鎖無限分析' });
     return;
   }
   ```
3. 成功呼叫後 `incrementUploadCount()`（沿用截圖解析既有計數器）
4. 按鈕視覺：當配額用完時顯示 disabled 狀態 + 鎖頭 icon

---

## BUG 2：語意色錯置修復（14 處）
**問題**：theme 層的 `C.up` / `C.down` 已改橘+灰，但 inline 程式碼裡有些地方把「警示 / 預測正確 / 預測錯誤 / 失誤」映射到 `C.up` 或 `C.down`，導致語意倒錯（例：「預測錯誤 = 橘色 = 賺錢」這種對撞）。

**檔案**：`src/pages/FreeCheckup.jsx`、`src/checkup/components/watchlist/WatchlistPanel.jsx`、`src/checkup/seedData.js`

**修法（語意映射重定義）**：
| 場景 | 原本 | 改為 |
|------|------|------|
| 損益正/負 | C.up / C.down | 維持（橘/灰） |
| 警示 / 危險 / 失誤 | C.up（橘）| `C.amber` 警示色 |
| 預測正確 | C.olive / C.teal | 維持灰綠 |
| 預測錯誤 | C.up（橘）| `C.textMute` 灰 |
| 產業分類標籤 | C.up | `C.textMute` 中性 |
| 刪除確認 | C.up（橘）| 維持（橘是合理警示）|

具體行：
- FreeCheckup L2091, L2107（urgency dot）→ `C.amber`
- FreeCheckup L3337, L3886, L3928, L3929, L3932, L4025（預測對錯）→ 錯誤改 `C.textMute`
- FreeCheckup L3971-3973, L4084-4086（up/down 預測 chip）→ 改成 ↑橘 / ↓灰，移除底色 chip
- WatchlistPanel L284-287, L417 → 改 `C.amber`
- seedData L364, L371（產業 tag）→ 改 `C.textMute`

---

## BUG 3：Sparkline 方向色
**問題**：`sparklines[h.code]` 的折線圖目前固定色，沒跟著該檔損益方向走。

**檔案**：`src/pages/FreeCheckup.jsx` L2439, L2485, L2593
**做法**：sparkline 末值 vs 首值決定方向：
```js
const sparkColor = sparkData.length > 1 && sparkData[sparkData.length-1] >= sparkData[0]
  ? WB.accent  // 上升 → 橘
  : WB.inkMute; // 下降 → 灰
```
Stroke 1px、無填色，與卡片 hair line 一致。

---

## BUG 4：edge function `checkup-sparkline` 失敗時的靜默處理
**問題**：L805 `/* silent */` 失敗時整排 sparkline 消失但無提示，使用者不知道。
**做法**：失敗時改顯示 `—` 短橫線 placeholder（11px、`C.inkLight`），保留版位不塌陷，但不打擾。

---

## 孤兒元件決議：保留作為樣板（option ①）
**結論**：經 rg 全專案搜尋確認，`HoldingsWorkbench / HoldingHero / HoldingCard / PriorityStrip / HoldingDetailPanel` **零外部引用**。它們是上一輪嘗試抽元件、被 `inline-rendering-audit` 擋下的殘骸。

**處理方式**：
1. 在 `src/checkup/components/holdings/README.md` 新增一段說明：
   > 本目錄為「持倉看板未來抽元件樣板庫」。FreeCheckup.jsx 目前採 inline 渲染（見 `inline-rendering-audit` 記憶），這些元件保留作為日後新建獨立持倉頁時的設計參考，請勿直接 import 至 FreeCheckup。
2. 在每個元件檔頂端加 `// @template-only - not imported by /free-checkup` 註解
3. 不刪除（保留設計資產）、不掛上（遵守記憶）

更新記憶 `mem://architecture/checkup/inline-rendering-audit`，補充孤兒元件的存在與用途。

---

## 不做的事
- 不改 zustand store
- 不重構 FreeCheckup.jsx 的 inline 結構
- 不重新引入紅綠色（即使是淺色）
- 不掛載孤兒元件至任何路由

---

## 涉及檔案（5 支）
1. `src/pages/FreeCheckup.jsx` — BUG 1, 2, 3, 4 主修
2. `src/checkup/components/watchlist/WatchlistPanel.jsx` — BUG 2 語意色
3. `src/checkup/seedData.js` — BUG 2 產業 tag 中性化
4. `src/checkup/components/holdings/README.md` — 孤兒元件說明（新建）
5. `src/checkup/components/holdings/*.jsx`（5 支）— 各加一行 template-only 註解

## 驗證方式
- 視覺：FreeCheckup 整頁掃過，確認沒有任何「紅綠對撞」殘留
- 行為：用 LINE 帳號連續觸發事件預測 2 次，第 2 次應被擋下
- Sparkline：找一檔正報酬與一檔負報酬，確認折線顏色相反
