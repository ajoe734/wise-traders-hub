# 持倉看板「持續重新整理」與「新增持股載入久」根因調查與修復

範圍：`/holding-checkup`（`src/pages/FreeCheckup.jsx` + `HoldingsTab` 及其子元件）。只用 Preview demo/隔離資料，不寫正式持倉、不做 migration/deploy/Publish。

## 1. 已靜態確認的刷新來源（有程式證據）

| # | 來源 | 檔案/函式 | 觸發 | 動作 | 類別 |
|---|---|---|---|---|---|
| A | 報價即時頻道 | `FreeCheckup.jsx` L760-800 `current-prices-fc` | 任一持股 `current_prices` 變動 | `setHoldings(prev.map…)` 產生**新陣列** | 報價更新＋整棵 rerender |
| B | 進頁/持倉變動自動刷新 | `FreeCheckup.jsx` L1666 effect deps `[tab, holdings]` | **每次 holdings 參考改變**（含 A 的每筆報價） | 延遲 300ms 呼叫 `runAutoRefresh` | 報價批次重抓 |
| C | 週期自動刷新 | L1675 setTimeout 鏈，deps `[tab, holdings?.length]` | 每 N 分鐘（預設 5）＋設定變更 | `runAutoRefresh` | 報價批次重抓 |
| D | 收盤待補判斷 | `closeAlignment.ts` L98 `needsCloseAuthorityRefresh` | 收盤後只要任一檔 `priceState==='pending'` 或 tradeDate≠預期交易日 → true | 讓 B/C 繞過「5 分鐘未過期」門檻，只剩 60 秒節流 | **疑似熱迴圈** |
| E | 投組估值 | `usePortfolioValuation.ts` L86 `key = code:Math.round(value)` | **市值一變就換 key** → 重打 `valuation_peer_medians` | 批次 RPC | 估值重抓 |
| F | 同一 hook 兩個實例 | `PortfolioValuationStrip.tsx:52`、`HoldingsSectorValuation.tsx:117` | E 的每次觸發 ×2 | 兩次相同 RPC | 重複請求 |
| G | 估值 30 分鐘 interval + focus/visibility | `usePortfolioValuation.ts` L166-182 | 30 分鐘、切回分頁 >5 分鐘 | 批次 RPC ×2（F） | 估值重抓 |
| H | 法人明細 stamp 輪詢 | `useTwChipsDetail.ts` L94-196 `refetchInterval STAMP_POLL_MS`＋online/visibility | 抽屜開啟時 | 查 stamp | 抽屜限定 |
| I | Hero 相對時間 | `HoldingsHero.tsx:99` 30 秒 | 定時 | 只 rerender Hero | 純 rerender |
| J | 配額 tick / 冷卻倒數 | `FreeCheckup.jsx:134`（60s）、`:392`（500ms，僅冷卻中） | 定時 | **整頁 FreeCheckup rerender** | 純 rerender |

## 2. 根因假設（依可信度）

1. **H1 回饋迴圈 A→B→E**：一筆報價推送 → holdings 新參考 → B 重跑 gate、E 市值 key 改變 → 兩個估值實例各打一次批次 RPC。盤中 20 檔會持續觸發，這是「莫名持續重新整理」最可能主因。
2. **H2 pending_close 熱迴圈 D**：Preview 顯示 3 檔 pending_close、最舊 tick 2026/06/09。收盤後 D 恆為 true；若 sparkline authority 回傳非 `transport ok`，`authorityDoneRef` 不記錄，每 60 秒重打整批報價，且沒有退避。
3. **H3 新增持股同步等待**：加一檔 → length 改變 → C 重建 timer、B 觸發全批報價、E/F 雙倍估值 RPC、分類/名稱/sparkline 一起等；列是否在儲存後立即出現尚未確認。
4. **H4 過期回應**：B/C 的 `refreshPrices` 無 AbortController、無請求序號，舊回應晚到可能覆寫新狀態；E 有 `cancelled` 旗標但 RPC 本身未取消。

## 3. 證據缺口（Build 第一步先補，結果寫入 `.scratch/holdings-refresh/evidence.md`）

- 新增持股的實際路徑（寫入函式、是否 `await` 報價/分類/估值）尚未讀完 → 讀 `FreeCheckup.jsx` 新增/上傳 handler、`refreshPrices`、`useSparklines`、`syncEngine`。
- 「輕量批次查詢」獨立驗證：唯讀 `EXPLAIN ANALYZE select valuation_peer_medians(<20 檔>)` 量時間，確認不呼叫 history/trend；在 Preview 網路面板量回應時間。
- demo 模式下 A（realtime）是否關閉（程式有 `isDemo` 早退），demo 的 20 檔基線是否實際走 D 路徑。
- `current_prices` 真實推送頻率（唯讀查 `pushed_at` 分佈）。
- React Profiler／render counter（已有 `useRenderCounter`）量 10 分鐘 rerender 次數。

### 基線量測方案（Playwright，Preview demo，1440）
- 攔截所有 `/rest/v1/*`、`/rpc/*`、`/functions/v1/*`，依端點分類計數；閒置 0–1、1–5、5–30 分鐘三段（以 `page.clock` 快轉）。
- 同時記錄 remount（元件 mount 計數）、整頁 reload（navigation 事件）、render 次數，四類分開列。
- 新增一檔：記錄 T0 按下儲存 → first-row 出現 → 報價填入 → 估值/族群區塊 ready 的毫秒數，與各階段請求數。

## 4. 修復方案（最小完整）

1. **報價只更新變動列**：realtime handler 價格未變則回傳原物件、全部未變回傳原陣列；抽出 `quoteVersionKey`（代碼集合）給 B，改 deps 為 `[tab, codesKey]`，不再因價格變化重跑。
2. **估值 key 改為代碼集合**：`usePortfolioValuation` 只以代碼集合決定是否重抓；權重在前端用最新市值重算（`computePortfolioValuation` 本就吃 weight），價格變動 0 RPC。
3. **估值去重與快取**：新增模組級 `peerMediansCache`（key=排序後代碼，TTL 30 分鐘，上限 8 組，in-flight promise 共享），兩個實例共用；代碼集合改變時舊請求結果以序號丟棄。新增一檔只查新增代碼再合併。
4. **pending_close 退避**：`runAutoRefresh` 對同一 fingerprint 失敗/無新資料採 1→2→5→15→30 分鐘退避（上限不超過使用者設定的區間倍數），交易日改變或使用者手動刷新才重置；非交易時段不因 D 繞過間隔。
5. **請求取消與過期保護**：`refreshPrices` 加請求序號（及可行處 AbortController），只接受最新序號回應；合併時僅覆寫價格相關欄位，不覆寫使用者正在編輯的股數/成本（以 `editedAt > requestStartedAt` 判定保留）。
6. **新增持股非阻塞**：儲存後立即 `setHoldings` 顯示列（價格顯示「取價中」），報價只抓該代碼，法人/估值/分類各自背景載入並以 skeleton 呈現；不觸發全批刷新。
7. **整頁 rerender 收斂**：J 的 60 秒 quota tick 與 500ms 倒數下沉到使用它的子元件，避免整個 FreeCheckup 重繪。
8. **設定一致**：Hero 顯示「下次更新 HH:MM」與實際 timer 同源；關閉自動時 B/C/D 全停（只剩使用者手動與 realtime）。

## 5. 驗收 gate

- 單元（vitest fake timers）：閒置 1/5/30 分鐘請求數符合設定；visibility/focus/online 各一次；pending_close 退避序列；連續新增兩檔只各查一次新代碼；舊回應晚到被丟棄；背景刷新不覆寫輸入中的欄位；價格推送 0 次估值 RPC；兩個估值實例共 1 次 RPC。
- Playwright（Preview demo）：前後對照 20 檔基線請求數與 first-row/fully-loaded 延遲表；慢網路（route 延遲 3s）下列仍在 <500ms 出現；1440/1024/390 無溢出。
- 回歸：估值三把尺/同業明細/投組估值/產業族群區塊正常，關鍵分點仍不存在；`portfolio-valuation-autorefresh`、`portfolio-bucket-valuation`、`valuation-rulers*`、`freecheckup-card` e2e 通過。
- 全量測試、tsgo、module-boundaries、build、security scan 0 Critical。

## 技術細節：預計修改檔案
- `src/pages/FreeCheckup.jsx`（realtime 合併、B/C deps、runAutoRefresh 退避與序號、新增持股流程、tick 下沉）
- `src/checkup/lib/closeAlignment.ts`（退避輔助 `nextCloseRetryDelay`）
- `src/checkup/hooks/usePortfolioValuation.ts`＋新 `src/checkup/lib/peerMediansCache.ts`
- `src/checkup/components/freecheckup/HoldingsHero.tsx`（下次更新時間）
- 新測試：`src/test/unit/holdings-refresh-sources.test.tsx`、`peer-medians-cache.test.ts`、`e2e/holdings-refresh-baseline.spec.ts`
