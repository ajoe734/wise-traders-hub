## 根因盤點（已用 DB / 檔案讀取核實）

| # | 根因 | 現況證據 | 為何前一版沒治本 |
|---|---|---|---|
| R1 | `current_prices.updated_at TEXT`、`pushed_at` 用途不明 | `\d current_prices` 顯示 `updated_at text`；一列 `2317` 停在 4/8 仍被讀出 | 只加 cron 不改 schema，freshness 判斷永遠不準 |
| R2 | 讀取端無 TTL 守門 | `useMarketData` 直接吐 DB 值 | 只補寫入端，過期值仍會顯示 |
| R3 | market×writer 沒有合約測試 | `us-stock-quote` 從未被任何 cron 呼叫（US 列 = 0） | 手動再加一條 cron，下次還是會重演 |
| R4 | 雙寫入路徑，無 canonical writer | `stock-price-sync` / `us-stock-quote` 各自 upsert | 無法保證「新值不被舊值蓋掉」 |
| R5 | 無 API 配額守門（Finnhub / TWSE / Binance） | 對比 BSR 走 `finmind_admit_v2`，價格路徑裸奔 | 5 分鐘 cron 上線立即會撞額度 |
| R6 | Sync universe 是 function 參數/硬編 | 4/8 起 2317 沒再更新，因為掉出清單 | universe 改成 view 才是唯一真相源 |
| R7 | Watchdog 只監控「cron 有沒有跑」 | crypto cron 掛 11 天無人知 | 需監控寫入結果 SLO |
| R8 | 沒有失敗即降級的視覺契約 | 過期價當現價顯示 | UI 需明示 "unavailable"，才會早期被抓 |

## 根治計畫（治 R1–R8）

### 1. Schema 收斂為單一時間欄位（治 R1）
Migration：
- `current_prices.updated_at` → `timestamptz NOT NULL DEFAULT now()`（就地轉型，先 backfill 從 `pushed_at`／文字解析）。
- 移除語義重疊的 `pushed_at`，或保留但改成 `GENERATED ALWAYS AS (updated_at) STORED` 過渡期。
- 加 `stale_seconds int GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (now() - updated_at))::int) STORED` 供索引。
- 加 partial index：`(market, updated_at DESC)`。

### 2. 唯一寫入通道：`upsert_current_price` RPC（治 R4）
- SECURITY DEFINER，只接受服務端呼叫。
- 內含 guard：`ON CONFLICT DO UPDATE ... WHERE EXCLUDED.updated_at > current_prices.updated_at`——**舊值不得覆蓋新值**。
- 記錄 writer 名稱到 `current_prices.writer text`（增欄）便於稽核。
- 三個 sync function 全部改走這條 RPC；直接 `upsert to table` 的舊路徑刪除。

### 3. Universe = View，不是參數（治 R6）
- 新增 `public.v_price_sync_universe(market, symbol, priority)`：聯集 `trade_records.instrument`（open）、`expert_signals.instrument`（180 天）、`crypto_symbol_map`、`checkup_storage` 使用者持倉快照。
- 依市場正則拆 TW / US / CRYPTO，權證單獨標 priority。
- 三個 sync function 唯一資料來源 = 這個 view。**沒有任何硬編清單允許存在**（PR 檢查會 grep 阻擋）。

### 4. 配額守門：`price_admit(market, symbols[])`（治 R5）
- 仿 `finmind_admit_v2` 建 `price_quota_pools`（Finnhub 60 req/min / TWSE 每分鐘上限 / Binance 1200/min）+ `price_quota_ledger`。
- 每次 sync 先 admit，超額回退到「下一波」而不是打爆上游。
- 熔斷復用 `chips-guardian`：連續失敗率 > 30% 自動 kill-switch。

### 5. Cron 三市補齊（不再空市場）（治 R3）
- **TW**：Mon–Fri 台北 08:55–13:35 每 5 分鐘 + 13:35 收盤 + 20:00 修正檔。
- **US**：Mon–Fri 美東 09:25–16:05 每 5 分鐘（含盤前盤後可選）。
- **CRYPTO**：24×7 每 5 分鐘。
- 所有 cron 寫入 `cron_dispatch_log`。

### 6. 合約測試（治 R3 從此不再重演）
- Vitest：`price-writer-contract.test.ts` 直接查 DB，assert 每個 market 在合理窗口內都有 rows with `updated_at > now() - <SLO>`，違反即 CI fail。
- Vitest：檢查 `cron.job` 至少各有一條 job 涵蓋 TW/US/CRYPTO；缺一 fail。
- Playwright：模擬付費會員 → 每張持倉卡片現價 vs `current_prices` 一致；差異或缺失即 fail。

### 7. 讀取端 SLO 守門（治 R2、R8）
- 新增 `src/checkup/lib/priceFreshnessPolicy.ts`：依 market + 現在是否盤中回傳 `maxAgeMs`。
- `useMarketData`：對每筆讀到的價格計算 age，超過 `maxAgeMs` 就：
  1. 前端立即降級：顯示 `—` + tooltip「即時價暫時無法取得」，不再拿舊值魚目混珠。
  2. 觸發新的 `price-fill-on-demand` edge function（走 `price_admit` + 唯一 writer RPC）補齊，成功後 realtime 重繪。
- Realtime 訂閱 `current_prices` 讓補齊後 UI 自動刷新。

### 8. Freshness Watchdog（治 R7）
- `v_price_freshness`：`market, universe_count, covered_count, p50_age_s, p95_age_s, max_age_s`。
- `chips-guardian` 每 10 分鐘檢查：
  - 盤中 p95 age > SLO → 中等告警。
  - `max_age_s` > 6h 且應在盤中 → 高告警 + notification 給 admin。
  - `covered_count / universe_count < 0.95` → 觸發 `price-fill-on-demand` 批量補齊。
- 後台 `/company/data-source-health` 增加 Price Freshness 卡（三 market 三行）。

## 交付順序（每步都要能單獨驗證）

1. Migration：`updated_at` → timestamptz + `writer` + 索引 + `v_price_sync_universe` + `v_price_freshness` + `upsert_current_price` RPC + `price_quota_pools/ledger` + `price_admit` RPC。
2. Edge：三個 sync function 改走 RPC + admit；新增 `price-fill-on-demand`；修 `crypto-price-sync` boot。
3. Cron 三市重排 + dispatch log。
4. 前端：`priceFreshnessPolicy` + `useMarketData` 降級與補齊 + Realtime。
5. Watchdog + Health 卡 + 告警。
6. 合約測試（Vitest + Playwright）併入 CI。
7. 驗證：手動觸發三 sync → freshness p95、云云帳號實測、Playwright 全綠。

## 技術細節

- `updated_at` 型別轉換用兩步 migration：新增 `updated_at_ts timestamptz`，backfill，再 rename，避免 downtime。
- `upsert_current_price` 需 `SECURITY DEFINER` + `set search_path = public`；只 grant 給 `service_role`。
- `price_quota_pools` 每個 market 一列，欄位對齊 `finmind_quota_pools`。
- 前端 SLO：TW/US 盤中 15 min、盤外 24 h；CRYPTO 10 min 24×7。
- `price-fill-on-demand` 需 request coalescing（沿用 `requestCoalescer.ts`）避免同秒多次觸發。
- 合約測試白名單假日（TW 國定假日 + 美股 NYSE calendar）避免誤報。

## 不做的事
- 不動 `/holding-checkup` demo（訪客）路徑的 in-memory 價格。
- 不新增付費會員以外的 API 消耗。
- 不改 `signals` 記錄的歷史成交價（那是交易紀錄，不是現價）。
