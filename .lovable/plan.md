## 現況（已驗證）

| 資料表 | 筆數 | 最新 |
|---|---|---|
| `tw_institutional_daily`（三大法人）| 27,661 | 2026-07-20 ✅ |
| `tw_bsr_daily`（分點）| **0** | **從未成功寫入** ❌ |
| `tw_bsr_fetch_failures`（未解決）| 71 檔 | 全部 `captcha_retry_exhausted` |
| `tw_bsr_attempt_logs` | **0** | logAttempt 靜默失敗，等於瞎子 |

結論：抽屜顯示「分點資料尚未同步 / 尚無歷史序列資料」不是前端 bug，是後端從來沒有一筆 BSR 成功。過去我補的六層防禦、自適應、預處理、回放測試都是**建在破損地基上**——TWSE 官方 BSR 頁面 (bsr.twse.com.tw) 的 CAPTCHA 對 Gemini Vision 的識別率實務上接近 0，再多預處理也救不回來。

同時 `logAttempt` 用 `try/catch` 靜默吞例外（`/* best-effort */`），導致連 debug 線索都沒有。

## 修正計畫

### 1. 打開黑盒：修 attempt_logs 靜默失敗（先做，30 分鐘）
- 檢查 `tw_bsr_attempt_logs` 的 GRANT/RLS——service_role 應可寫；若缺 GRANT 直接補。
- `logAttempt` 改成**失敗時 `console.error` 一次**（不阻斷主流程但至少 edge logs 能看到）。
- 立刻手動觸發一次 sync，用 `edge_function_logs` 確認實際 OCR 回傳（目前搜 `ocr`/`captcha`/`error` 全都 no match，代表現行程式碼根本沒 log 過 OCR 決策）。

### 2. 換資料源：新增無 CAPTCHA 的 BSR 抓取器（主修）

TWSE 官方 BSR 只有 captcha 版；但有**兩個穩定替代來源**可選：

**方案 A — FinMind API**（推薦，免費、有 rate limit 但可接受）
- `TaiwanStockShareholding` / `TaiwanStockInstitutionalInvestorsBuySell` 之外，`TaiwanStockPortfolioBrokerTrading` 提供每日分點淨買賣。
- 新 edge function `tw-bsr-finmind-sync`：無需 OCR，直接 REST。
- 需要 `FINMIND_TOKEN`（免費 sign up）→ 用 `add_secret` 請使用者提供。

**方案 B — 若不想外部依賴**：直接抓 `bsr.twse.com.tw` 的 XLS 版本（部分股票有匯出鍵，不走 captcha）。覆蓋率較窄，只做 top 500。

→ 建議 A 為主、B 為降級，並在 UI 顯示資料來源標籤。

### 3. 改造現有 `tw-bsr-daily-sync` 為降級鏈
```
FinMind → 若 quota 用盡 → XLS 抓取 → 若失敗 → 原 OCR 路徑（保留但不再主打）
```
成功來源寫進 `tw_bsr_daily.source_provider`（新欄位）。

### 4. 前端 ChipsSection 訊息校準
- 目前的琥珀色 banner 假設「有 last_successful 可退回」，但實際 last_successful 永遠 null。
- 補一個空狀態：「分點資料尚未同步」→ 顯示「本專案 BSR 由 FinMind 提供，若首次同步中請稍候（背景任務每 30 分執行）」。
- 移除誤導性的「TWSE 18:15 抓取」文案。

### 5. Admin 手動觸發按鈕
`/company/bsr-config` 新增「立即回填近 5 個交易日」按鈕，走新的 FinMind 流程，方便你當場驗證。

## 技術細節

**新 migration**
- `tw_bsr_daily` 加 `source_provider text default 'twse_ocr'`
- `tw_bsr_attempt_logs` 檢查 GRANT `INSERT` to `service_role`（若缺就補）

**新 Edge Function**：`tw-bsr-finmind-sync`
- 每 30 分排程（Taipei 09:00–20:00）
- 一次抓當日全市場 top N + `holding-checkup` 使用者持倉聯集，upsert 進 `tw_bsr_daily`

**新 secret**：`FINMIND_TOKEN`（會用 `add_secret` 請你貼上）

**修改的檔案**
- `supabase/functions/tw-bsr-daily-sync/index.ts` — 改為降級 orchestrator
- `supabase/functions/tw-bsr-finmind-sync/index.ts` — 新
- `src/checkup/components/ChipsSection.tsx` — 空狀態文案
- `src/pages/company/BsrConfig.tsx` — 手動觸發按鈕

## 你需要決定

1. **資料源**：FinMind（推薦）／XLS-only／繼續死磕 OCR？
2. **FinMind Token**：若採 A，能否提供？（免費註冊 finmindtrade.com）

我先等你回覆 (1)(2) 再進 build。