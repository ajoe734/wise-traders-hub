

# 股票名稱快取 + 後端遷移 整合計畫

## 關於你的想法：同意，微調一處

你的「`stock_names` 表 + 2 秒批次打包」方案完全合理。`stock_names` 表已經建好（symbol PK + name），RLS 也已設定為公開讀取。

**一處微調：** 2 秒批次窗口在「單一分析師打字」場景下會讓使用者等 2 秒才看到名稱，體感偏慢。建議改為：
- 先查 `stock_names` 表（< 100ms）
- 命中 → 立即回傳，不觸發外部請求
- 未命中 → 進入 2 秒批次窗口，收集同時間所有 miss 的代碼，打包一次請求

這樣大多數情況下（表已有 2000+ 筆資料後）是即時回應，只有冷啟動期才會有 2 秒等待。

---

## 整合實作計畫

共 5 個步驟，將股票名稱快取 + Python 後端遷移合併為一次實施。

### 步驟 1：建立 `stock-name-lookup` Edge Function

負責批次查詢股票名稱並回寫 `stock_names` 表。

- 輸入：`{ symbols: ["2330", "2317", "3008"] }`
- 先查 `stock_names` 表，已有的直接回傳
- 未命中的打包成 `tse_2330.tw|otc_2330.tw|tse_2317.tw|...` 發送到 TWSE MIS API
- 從回傳的 `msgArray` 提取 `c`（代碼）和 `n`（名稱）
- 用 service role upsert 回 `stock_names` 表
- 回傳完整的 `{ "2330": "台積電", "2317": "鴻海" }` 結果

### 步驟 2：建立前端批次工具 `stockNameResolver`

一個共用的工具模組，供所有需要股票名稱的地方使用：

```text
resolveStockName("2330")
  → 檢查記憶體快取（Map）
  → 檢查 stock_names 表
  → 未命中 → 加入 pending 佇列
  → 2 秒後統一發送到 stock-name-lookup Edge Function
  → 回傳 Promise<string>（名稱）
```

### 步驟 3：修改 `Signals.tsx` 的 `fetchStockInfo`

- 移除對 `https://subsystem-production.up.railway.app/stock_info` 的直接呼叫
- 改用步驟 2 的 `resolveStockName(code)` 取得名稱
- 價格部分保持不變（從 `user_performances` 或之後的 `stock-price-sync` 取得）

### 步驟 4：建立 `stock-price-sync` Edge Function

合併 Python `main.py` 的功能 A + B + C：

1. 從 `trade_signals` 讀取所有 `status='open'` 的 symbol，去重
2. 打包成每組 ~100 檔的批次，呼叫 TWSE MIS API（tse + otc 雙查）
3. 將價格 upsert 到 `current_prices` 表（用 service role）
4. 讀取 `trade_signals` 計算 PnL，更新 `user_performances`
5. 彙總更新 `user_summaries`（avg_pnl_percent）

### 步驟 5：建立 pg_cron 排程

設定定時任務，週一到週五開市時段每 30 分鐘觸發 `stock-price-sync`：

```
*/30 8-14 * * 1-5  →  呼叫 stock-price-sync Edge Function
```

使用與現有 `checkup-calendar-cron` 相同的 `net.http_post` 模式。

---

## 檔案變更清單

| 檔案 | 動作 |
|------|------|
| `supabase/functions/stock-name-lookup/index.ts` | 新建 |
| `src/lib/stockNameResolver.ts` | 新建 |
| `src/pages/admin/Signals.tsx` | 修改 fetchStockInfo |
| `supabase/functions/stock-price-sync/index.ts` | 新建 |
| `supabase/functions/daily-performance/index.ts` | 可能擴充 user_summaries |
| pg_cron SQL | 用 insert tool 執行 |
| `supabase/config.toml` | 新增 function 設定 |

