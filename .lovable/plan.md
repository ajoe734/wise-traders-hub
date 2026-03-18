

# 按比例退款（Prorated Refund）方案規劃

## 概念

當訂閱者在月中取消訂閱時，系統應根據「已使用天數 vs 總訂閱天數」計算按比例退款金額，而非全額退款或完全不退。

## 計算邏輯

```text
總天數 = expires_at - started_at（天）
已用天數 = now() - started_at（天）
剩餘天數 = 總天數 - 已用天數
退款金額 = floor(月費 × (剩餘天數 / 總天數))

例：月費 NT$1,000，訂閱 30 天，已用 12 天
→ 退款 = floor(1000 × 18/30) = NT$600
```

## 實施步驟

### 1. 取消訂閱流程加入退款計算（Account.tsx）

在 `handleCancelSubscription` 中：
- 根據 `started_at`、`expires_at`、`price_monthly` 計算按比例退款金額
- 在確認對話框中顯示退款金額預覽（已使用天數、剩餘天數、退款金額）
- 取消成功後，自動建立一筆 `refunded` 狀態的 `payment_transactions` 記錄
- 同時寫入 `audit_logs` 記錄退款原因與金額

### 2. 取消確認對話框增強

目前對話框只有文字提示，需改為：
- 顯示「已使用 X 天 / 共 Y 天」
- 顯示「預計退款金額：NT$Z」
- 保留原有的 LINE 解綁提示

### 3. 退款記錄寫入

取消時自動插入 `payment_transactions`：
- `status: 'refunded'`
- `amount: 計算出的退款金額`（負數或正數，依慣例）
- `subscription_id: 對應訂閱 ID`

同時插入 `audit_logs`：
- `action: 'prorated_refund'`
- `detail: { reason: '按比例退款', used_days, total_days, refund_amount, original_amount }`

### 4. 金流管理頁面整合（Payments.tsx）

公司後台的交易紀錄已能顯示 `refunded` 狀態，無需額外修改。退款記錄會自動出現在交易列表中。

### 5. 需注意的邊界情況

- **無 `expires_at`**：若訂閱無到期日，以 30 天為預設週期計算
- **已超過到期日**：退款金額為 0
- **當天訂閱當天取消**：全額退款
- **年費方案**：使用 `price_yearly` 並以 365 天計算
- **RLS 限制**：`payment_transactions` 目前不允許 authenticated 用戶 INSERT，需透過 edge function 或新增 RLS policy 處理退款記錄寫入

### 6. 技術限制說明

此方案僅處理**系統內帳務記錄**。實際金流退款（如退回信用卡、LINE Pay 等）需要對接各金流商的退款 API，目前尚未整合。建議先完成帳務記錄，後續再串接實際退款 API。

## 涉及檔案

| 檔案 | 變更 |
|------|------|
| `src/pages/app/Account.tsx` | 加入退款計算邏輯、更新對話框 UI |
| `src/pages/company/Payments.tsx` | 無需修改（已支援顯示 refunded） |
| 資料庫 migration | 可能需新增 RLS policy 允許退款記錄寫入 |

