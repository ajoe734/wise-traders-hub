
# 持倉看板混入 Demo 個股 — 真正修復計畫

## 為何「之前說修好」其實沒修

目前線上邏輯（`src/pages/_freeCheckup/constants.jsx` L291-308）：

```js
DEMO_HOLDING_LOOKUP = new Map(INIT_HOLDINGS.map(h => [h.code, h]));
isExactDemoHolding(h) // 必須 qty/cost/price/value/pnl/pct 全部與 seed 完全相等才算 demo
stripDemoSeedHoldings = list => list.filter(h => !isExactDemoHolding(h));
```

只要 demo 股經過任何一次：
- Realtime 報價推送（`current_prices` 變動會改 price/value/pnl/pct，見 `FreeCheckup.jsx` L812-824）
- 手動「立即同步」/ backfill 補價
- 截圖上傳同代號 → 走 `mergeTradeIntoHoldings` 後 qty/cost 也會變
- 任何欄位四捨五入差 0.0001 以上

→ `isExactDemoHolding` 直接判 false → demo seed 整筆殘留 → `pf-holdings-v2` 雲端被寫入 → 之後每次登入都從 cloud 拉回，永遠帶著 demo。

DB 端查詢確認：目前 `checkup_storage / pf-holdings-v2` 中至少有 user `adecfb23…`（22 檔，含 demo seed code 1503/1717/2308/2313/2543/3006/3013/3017/3231/3443/3491/4583/6274/6770/6862/8227 共 16 檔幾乎全中）與 user `368462f1…`（28 檔）等多位使用者已被污染。

另外 bootstrap (`src/hooks/useFreeCheckupBootstrap.js` L153) 只在「本機載入」那次跑 `stripDemoSeedHoldings`，但 cloud 拉下來的 `cloud['pf-holdings-v2']` 本身就含污染資料，下次寫回時不會再被清。

## 修復範圍（程式 + 資料清洗）

### A. 程式：把「不准混 demo」變成單一憲法

A1. `src/pages/_freeCheckup/constants.jsx`
- 新增常數：`DEMO_SEED_CODES = new Set(INIT_HOLDINGS.map(h => h.code))`。
- 改寫 `stripDemoSeedHoldings`：對任何 `authenticated` 使用者，**只要 code 屬於 DEMO_SEED_CODES，且該筆持倉沒有任何「真實使用者來源」標記，一律剔除**。
  - 「真實使用者來源」定義：`priceSource === 'screenshot'` 或 `priceSource === 'manual'` 或存在 `userOrigin === true` 或有 `tradeLogTouched === true`。
  - 同時保留舊 `isExactDemoHolding` 給 demo 模式內部使用（demo 模式才能出現 seed）。
- 新增 helper `markUserOwnedHolding(h)` 在所有「使用者真的動到這筆持倉」的入口貼上 `userOrigin: true`。

A2. `src/hooks/useFreeCheckupBootstrap.js`
- L153 已 strip 本機，但 cloud 來源資料也要走 strip：把 `const h = pick('pf-holdings-v2', [])` 之後**永遠**呼叫 `stripDemoSeedHoldings(h)`，並且當 `removedDemoSeedCount > 0` 時：
  - 立刻把 sanitized 結果 upsert 回 `checkup_storage`（覆蓋污染雲端）。
  - 寫一筆 `function_run_logs` / console warn 方便追查。

A3. `FreeCheckup.jsx`
- L765 持倉 auto-save useEffect：在 upsert 前一律先跑 `stripDemoSeedHoldings(holdings)`，避免任何 race / 中間態把 demo 寫回。
- L2438 `setHoldings(prev => stripDemoSeedHoldings(prev || ...).map(...))`：強制 `markUserOwnedHolding` 標記新增匯入的持倉。
- L812-824 realtime callback：對 `DEMO_SEED_CODES.has(row.symbol) && !holdingHasUserOrigin(h)` 直接忽略，不再用 realtime 價把 demo seed 「洗白」成看起來真實的持倉。
- L218-227 demo 模擬 server-sync：也要忽略非 demo 模式（已有 `isDemo` 守門，保留）。

A4. `src/checkup/components/freecheckup/TradeTab.jsx`
- L327 既有 `stripDemoSeedHoldings(prev || [])` 保留，並把新建的 holding 一律 `userOrigin: true`。

A5. 新增單元測試 `src/test/unit/demo-seed-leak.test.ts`
- 對 16 個 seed code 各造一筆「改過 price」的物件 → 新版 `stripDemoSeedHoldings` 必須全部剔除。
- 對同 code 但 `userOrigin: true` 的物件 → 必須保留。
- 對非 seed code → 必須保留。
- 防止未來有人偷偷改回舊比對。

### B. 一次性資料清洗（migration / insert）

執行範圍：`public.checkup_storage` 中 `key = 'pf-holdings-v2'` 全表。

對每一個使用者：
1. 讀出 `data`（jsonb array）。
2. 對每個 element：
   - 若 `code` 不在 `DEMO_SEED_CODES` → 保留。
   - 若 `code` 在 `DEMO_SEED_CODES` 且 `priceSource in ('screenshot','manual')` 或 `userOrigin = true` → 保留（視為真實持倉）。
   - 否則 → 移除。
3. 把清洗結果 upsert 回去；同步把 `pf-calendar-v1.holdingCodes` 與 `pf-calendar-v1.events._holdingCodes` 重置為空字串（強制下次自動重抓行事曆）。
4. 也清掉 `pf-news-events-v1` 中 `source = 'calendar'` 且 `stocks` 全部對應到 demo seed 的事件。

撈一份 dry-run 報告（哪些 user_id、被刪幾筆、保留幾筆）給你看 → 你確認後執行 `update`。

### C. 文件 & 記憶

- 更新 `mem://qa/checkup/demo-mode-behavior` 與 `mem://features/checkup/data-isolation-architecture`：寫死「authenticated 模式下 DEMO_SEED_CODES 永遠不准出現於 `pf-holdings-v2`，唯一例外是 `userOrigin=true`」。
- 新增 `mem://constraints/checkup/no-demo-leak`：附對應測試檔路徑。

## 驗收標準（你檢查我有沒有偷懶）

1. 你重新整理 `/holding-checkup`，看板不再出現 1503/1717/2308/… 任一檔（除非你真的有上傳）。
2. DB 直接 query：
   ```sql
   select user_id, jsonb_array_length(data) from checkup_storage
    where key='pf-holdings-v2'
      and exists (select 1 from jsonb_array_elements(data) e
                   where e->>'code' in (...16 seed codes...)
                     and coalesce(e->>'priceSource','') not in ('screenshot','manual')
                     and coalesce((e->>'userOrigin')::bool,false) = false);
   ```
   → 必須回傳 0 筆。
3. `bunx vitest run demo-seed-leak` 全綠。
4. realtime 推 demo code 不再寫進非 demo 使用者的 `pf-holdings-v2`（手動實測 + console warn 觀察）。

## 不動的東西

- demo 模式（未登入）行為完全不變，照樣顯示 seed。
- `INIT_HOLDINGS` seed 內容、demoData.js、demo 行事曆都不動。
- 訂閱/付款邏輯不動（這次根因不在訂閱，是在持倉合併 / 報價 callback / cloud rehydrate）。
