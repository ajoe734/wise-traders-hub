## 持倉表加上「送出後預估股數」欄

### 改動
僅修改 `src/pages/admin/SignalEditor.tsx` 540–613 行的「目前持倉」表。

1. **新增 `useMemo`** 計算模擬持倉：
   - 初始 = `capital.open_positions` 映射成 `{ symbol, quantity: quantity_shares }`
   - 對每筆有 `stockCode` 的 trade draft，用 `normalizeSignalQuantityToShares` 換算成股數，連同 action 餵給 `simulatePositions()`
   - 結果為 `Map<symbol, simulatedShares>`

2. **表格新增「送出後」欄**（插在「股數」右邊）：
   - 無變動 → `—`
   - 全出清（0）→ 灰字「全數出清」
   - 減少 → 綠字（台股慣例：跌綠）顯示新股數 + `▾`
   - 增加 → 紅字 + `▴`

3. 未實現損益欄維持顯示「目前」值，不模擬。

### 驗證
- 點「出場 / 停損」：該列「送出後」顯示「全數出清」
- 點「減碼」並填數量：顯示剩餘股數（綠）
- 點「加碼」並填數量：顯示新股數（紅）
- 清空 draft：回到 `—`