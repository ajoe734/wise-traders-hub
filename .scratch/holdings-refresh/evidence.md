# 持倉看板刷新根因證據（2026-09-24）

## 已證實根因
1. 報價推送 → `setHoldings` 新陣列 → `FreeCheckup.jsx` 自動刷新 effect（deps `[tab, holdings]`）每次重跑 gate。修正：deps 改 `[tab, _holdingsCodesKey]`；realtime 價格未變回傳原陣列。
2. `usePortfolioValuation` key 含 `Math.round(value)` → 市值每變一次就重打 `valuation_peer_medians`，且兩個實例（投組估值條＋產業族群區塊）各打一次。修正：key 只看代碼集合、權重前端重算、`peerMediansCache` in-flight 去重＋TTL 30 分＋上限 8 組、請求序號丟棄過期回應。
3. `needsCloseAuthorityRefresh` 收盤後對 pending_close 恆 true → 只剩 60 秒節流。修正：同 fingerprint 退避 1→2→5→15→30 分（`nextCloseRetryDelay`）。

## 新增持股
`TradeTab.jsx` 套用時 `setHoldings` 同步寫入，列本身不等待報價/估值；延遲來自上述 1/2 的連鎖批次重抓。

## Playwright 量測（demo，修正後，fake clock）
| 視窗 | 0–1 分 | 1–5 分 | 5–30 分 | 橫向溢出 |
|---|---|---|---|---|
| 1440 | 0 | 3 | 18 | 無 |
| 1024 | 0 | 3 | 19 | 無 |
| 390 | 0 | 3 | 18 | 無 |
30 分鐘內 `valuation_peer_medians` 只 1 次（兩區塊共用）；`checkup-sparkline` 5 次（符合每 5 分鐘設定）。
修正前基線未保存（修正前程式已被替換），前後對照以單元測試鎖定：價格推送 5 次 → 估值 RPC 由 5×2=10 次降為 0。
