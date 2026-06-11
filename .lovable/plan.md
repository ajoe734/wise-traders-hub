## 問題定位

彥愷後台「績效總覽」顯示 1815 富喬、1514 亞力 為「持有中」，但「發布新週記」資金面板正確只顯示 6 檔。經查 DB：

- `trade_records`：1815、1514 皆為 `closed`（2026/06/09 已平倉），目前 `open` 只有 5 檔
- `trade_signals`：1815、1514 的**入場訊號** `status` 仍為 `open`（從未被後續賣出訊號同步更新）
- `trade_signals` open = 6（含已平倉的 1815、1514，少了已合併進 trade_records 的 1 檔）

### 兩個頁面的資料來源差異

| 頁面 | 來源 | 結果 |
|---|---|---|
| 發布週記資金面板 | RPC `get_expert_capital_status` → **只讀** `trade_records WHERE status='open'` | 6 檔 ✅ |
| 績效總覽未實現 | `useAdminPerformanceData` → `trade_records open` ＋ **trade_signals open fallback** | 6 ＋ 2 檔（多出已賣的 1815、1514）❌ |

`src/hooks/admin/useAdminPerformanceData.ts` L152-253 的設計原意是「補上尚未落地成 trade_records 的待發布訊號」，但 fallback 條件只排除「目前 open 的 trade_records」，沒有排除「已 closed 的 trade_records」。導致：mentor 發完賣出訊號 → trade_records 標 closed，但入場 trade_signals 仍是 open → fallback 把它當成「孤兒待處理訊號」補回畫面。

## 修法

調整 `useAdminPerformanceData.ts` 的 trade_signals fallback 邏輯，與資金面板的真相對齊：

1. **抓取 trade_records 時，同時抓 `status IN ('open','closed','stopped')` 的所有列**，建立「已知 symbol 集合」（任何狀態都算）
2. **trade_signals fallback 過濾條件改為**：只納入「`expert_id` 完全沒有任何 trade_records」的 symbol（真正的孤兒待處理訊號）
3. 既有 realtime channel 不動

### 為什麼不直接砍掉 fallback

導師流程確實存在「signal 已發但 trade_records 尚未生成」的短暫狀態（資料來自 `expert_signals` → `trade_records` 同步任務）。完全砍掉會掉資料；只是條件要正確。

### 技術細節

修改檔案：`src/hooks/admin/useAdminPerformanceData.ts`

- L162-169 區段：將 `trade_records` 查詢拆成兩段（或一次 select 全部狀態），算出 `allKnownSymbols` set
- L228-253：`tsRows` 過濾條件由 `!tradeSymbols.has(t.symbol)` 改為 `!allKnownSymbols.has(t.symbol)`
- realtime tradeChannel 的 INSERT/UPDATE/DELETE 不需動（已正確處理 trade_records 變動）

### 副作用評估

- 1815、1514 立即從績效總覽消失 ✅
- 真正未落地的 mentor signal 仍可顯示 ✅
- 不動 DB、不動 RPC、不動週記面板 ✅

### 驗證

1. 重新整理 `/admin/sharkgu/performance` → 持倉應為 6 檔，與週記面板一致
2. 持倉股數、均價、未實現損益應與週記面板逐檔對齊