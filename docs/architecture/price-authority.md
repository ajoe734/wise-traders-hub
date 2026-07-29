# 持倉價格權威來源架構（Price Authority）

> 建立日期：2026-07-29 · 對應 plan：`.lovable/plan.md — 持倉看板收盤價根因修復`

## 為何需要這份文件

歷史上，持倉看板的股價來自 client-side 直接打 `mis.twse.com.tw`，快取進 LocalStorage。結果：
- 收盤後 13:35 拉的 TW 價常與官方 14:05 才定案的收盤價不一致。
- US Stock 從沒接 DB 權威來源；US Option 完全沒有收盤 snapshot。
- LocalStorage 未過期時會蓋掉 DB 更新，造成「看到的價 ≠ 交易系統的價」。

本文件是根因修復後的**單一權威**，任何新增市場、任何新頁面顯示價格，一律遵守以下順序。

## 資料源優先順序（DB-first）

```text
┌─────────────────────────────────────────────────────────────┐
│  useAuthoritativePrices(symbols, market)                    │
├─────────────────────────────────────────────────────────────┤
│  1. marketPhase(market, now)                                │
│     ├─ hasSettledSnapshot=true → daily_price_snapshots      │
│     └─ else                    → current_prices + Realtime  │
│  2. DB miss?                                                │
│     ├─ online  → mark `stale`, background retry via edge fn │
│     └─ offline → LocalStorage fallback (offline-only)       │
└─────────────────────────────────────────────────────────────┘
```

**規則**：
1. **DB is truth**：`daily_price_snapshots` / `current_prices` 由 cron 寫入，是唯一權威。
2. **Client MIS 已下架**：`src/checkup/lib/marketSyncRuntime.js`、`missingPriceClient.js` 保留為 offline fallback，不再是主路徑。
3. **LocalStorage 語意**：`navigator.onLine === false` 才使用；命中即標記 `stale`。
4. **不確定就顯示 `stale` badge**：不允許無聲降級。

## Market Clock

`src/checkup/lib/marketClock.ts` 是唯一判定「今天有無權威收盤價」的來源。

| Market      | TZ                | 開盤   | 收盤   | Settle delay | Weekend |
|-------------|-------------------|--------|--------|-------------|---------|
| `TW`        | Asia/Taipei       | 09:00  | 13:30  | 35 min → 14:05 | skip |
| `US`        | America/New_York  | 09:30  | 16:00  | 10 min → 16:10 | skip |
| `US_OPTION` | America/New_York  | 09:30  | 16:00  | 15 min → 16:15 | skip |
| `CRYPTO`    | UTC               | 24h    | 24h    | 0             | 24/7   |

Settle delay = 官方定價落地時間，前端在此時間之前只讀 `current_prices`（intraday），之後才切到 `daily_price_snapshots`。

## Cron 排程（實際跑的 job）

| jobname                          | schedule (UTC)  | Local time            | 用途                          |
|----------------------------------|-----------------|-----------------------|-------------------------------|
| `tw-price-sync-close`            | `35 5 * * 1-5`  | 13:35 TPE             | 早班 intraday tail            |
| `tw-price-sync-close-correction` | `5 6 * * 1-5`   | **14:05 TPE**（Phase 4 修）| **官方收盤定價**              |
| `us-price-sync-close-edt`        | `5 20 * * 1-5`  | 16:05 EDT             | 美股 EDT 收盤                 |
| `us-price-sync-close-est`        | `5 21 * * 1-5`  | 16:05 EST             | 美股 EST 收盤                 |
| `us-option-price-sync-edt`       | `10 20 * * 1-5` | 16:10 EDT             | **選擇權 mark price（Phase 1）**|
| `us-option-price-sync-est`       | `10 21 * * 1-5` | 16:10 EST             | **選擇權 mark price（Phase 1）**|
| `crypto-price-sync-daily`        | `0 0 * * *`     | 00:00 UTC             | Crypto 日結                   |

Function 內部會用 `nyClock()` / `getTaipeiClock()` 二次判定，EDT/EST 雙 cron 一天只會實跑一次。

## Combo 定價（US Option）

`is_combo=true` 的部位由 `useAuthoritativePrices` 特別處理：

1. 讀 `expert_signal_legs`，每腿轉成 OCC 21 碼（`src/lib/optionCombo.ts::buildOccSymbol`）。
2. 對 `current_prices` 撈每腿 mark price（`asset_class=us_option`）。
3. 依照 `optionCombo.ts::calcNetPremium` 邏輯計算 net value：`Σ sign(side) × price × ratio × 100`。
4. 缺任一腿 → 整組標為 `stale`。

## 監控指標（Phase 5 — 已上線）

寫入 `price_parity_events`（RLS：使用者只能 insert 自己的、僅 `company_admin` 可讀）：

| 欄位 | 意義 |
|------|------|
| `symbol` / `market` | 觸發標的與市場 |
| `db_price` / `cache_price` | DB 權威價 vs LocalStorage 快取價 |
| `diff_pct` | 落差百分比（門檻 > 0.5%） |
| `source` | `snapshot` 或 `current`（哪一種 DB 來源命中） |

Client 端寫入邏輯（`useAuthoritativePrices::reportParityMismatches`）：
- 僅在 `navigator.onLine === true` 且同時取得 DB 與 cache 價格時比對
- 每個 `symbol|source` 6 小時內只回報一次（LocalStorage dedupe）
- 寫入失敗一律吞掉，不影響 UI

儀表板：`/company/perf-metrics` → **價格一致性事件** 卡片，呼叫 `get_price_parity_summary(_days)` RPC 匯總 events / 涉及個股數 / avg & max diff，並列前 20 名高頻標的。


## 故障排除

| 症狀                                     | 首查                                                              |
|------------------------------------------|-------------------------------------------------------------------|
| 持倉價與收盤官方對不上（TW）             | `SELECT * FROM daily_price_snapshots WHERE symbol='...' AND market_date=CURRENT_DATE` |
| US option 部位一直 stale                 | `SELECT symbol,updated_at FROM current_prices WHERE asset_class='us_option'` + edge log |
| Client 顯示舊價                          | 檢查 `navigator.onLine`；若 online 但仍舊，看 `useAuthoritativePrices` mismatch 事件 |
| Combo net value 錯                       | 逐腿檢查 `current_prices`；比對 `optionCombo.ts::calcNetPremium` |

## 實作狀態（滾動更新）

| Phase | 交付物                                    | 狀態          |
|-------|-------------------------------------------|---------------|
| 1     | `us-option-price-sync` + tests + cron     | ✅ 已上線      |
| 2     | `marketClock.ts` + tests                  | ✅ 已上線      |
| 2     | `useAuthoritativePrices` hook             | ✅ 已上線      |
| 3     | 拔除 MIS 主路徑、component 改用新 hook    | 🚧 待實作      |
| 4     | TW cron 14:05                             | ✅ 已上線      |
| 5     | `price_source_mismatch` telemetry + card  | 🚧 待實作      |
| 6     | `e2e/holdings-price-parity.spec.ts` + CI  | 🚧 待實作      |

## 不可觸碰

- `src/integrations/supabase/client.ts`、`types.ts`、`.env`
- `mis.twse.com.tw` 直接呼叫已下架，禁止在新的 checkup 檔案重新引入
