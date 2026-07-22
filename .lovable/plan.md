# 週記系統最終驗收計劃

目前 P0（Step 1–9）+ P1（Step 10）+ P2（C7/C8/C9/B4）皆已收斂，但「可以完美運行」需要用一次窮舉驗收才能斷言，不能只靠印象。以下是我要跑的清單。

## 驗收範圍（六層全查）

### 1. 資料稽核（Runtime data）
- `node scripts/audit-journal-authoring.mjs` — 6 類（單位/品質/資金/slug/貨幣/張整數）必須全 0
- 額外查：`expert_signals` 近 30 日 `status='published'` 但 `trade_records` 缺對應行的孤兒
- 額外查：`trade_records` 近 30 日 `avg_cost`/`realized_pnl` 有 NULL/NaN 的異常筆

### 2. Edge Function 錯誤碼（Server contract）
- `publish-weekly-journals`：確認 `UNIT_MIX / DIRECTION_OVERSELL / CAPITAL_INSUFFICIENT / MISSING_PRICE / DB_ERROR` 五類都有中文訊息 + 修正連結
- `update-analyst-credentials`：GoTrue 錯誤中文化仍在
- 呼叫兩支 function health check 確認 200

### 3. 單元／整合測試（Code contract）
- `bunx vitest run` 全套（1783+ tests）必須全綠
- 重點檔：`displayLayerUnit`、`signal-editor-currency`、`signal-editor-mixed-batch`、`1.37-us-asset-unit-single-source`、`positionQuantity`

### 4. E2E（User flow）
- `bunx playwright test e2e/journals-export` 全套（171）
- `bunx playwright test e2e/signal-detail-preview-currency-schema e2e/notification-link-routing`
- 新增／確認一支 sell/trim 「全部持有」按鈕的 e2e（C9 剛落地，尚無 e2e 覆蓋）

### 5. 憲法一致性（Code review）
- grep `sanitizeAssetQuantityUnit` 使用點是否覆蓋所有寫入 `trade_records.quantity_unit` 的路徑
- grep 有無殘留「currency==='TWD' ? '張' : '股'」舊邏輯
- `handle_signal_trade` 觸發器與前端 sanitizer 的單位規則字對字一致

### 6. 生產監控（Prod state）
- 近 7 日 `function_run_logs` 中 `publish-weekly-journals` error rate
- 近 7 日 `audit_logs` 中 `admin_reset_expert_asset_class` 是否有意外呼叫
- CI nightly `journal-authoring-audit` 最近三次執行結果

## 交付

跑完六層後，我會給你一份短報告：

```
[PASS/FAIL] 資料稽核       0/0/0/0/0/0
[PASS/FAIL] Edge function  5 錯誤碼齊備
[PASS/FAIL] Unit tests     N/N
[PASS/FAIL] E2E            N/N
[PASS/FAIL] 憲法一致性     無殘留舊邏輯
[PASS/FAIL] 生產監控       近 7 日 0 錯誤
```

任何一層 FAIL 會列出具體筆數／檔名／錯誤訊息，並提出對應修法。全綠才會回你「可以完美運行」。

## 技術細節

- 只讀操作為主；C9 若補 e2e 需要 build mode
- 預估：稽核 + 測試 + grep 約 5–8 分鐘
- 不動任何 schema 與資料
