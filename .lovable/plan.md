## 目標

針對匯款（remittance）流程三個強化：
1. 建立訂單的冪等與重試（避免重整／連點建出重複訂單）
2. `/account/remittance` 回填表單的驗證與送出鎖定
3. 訂單狀態追蹤區塊（含即時更新）

---

## 1. 建立匯款訂單：冪等 + 重試

### Edge Function `create-expert-remittance`
- 新增 `client_request_id`（uuid，前端產生）作為冪等鍵：
  - 在 `remittance_orders` 新增欄位 `client_request_id uuid`，加 `unique (user_id, client_request_id)` index。
  - 若同一 `(user_id, client_request_id)` 已存在 → 直接回傳既有 `orderId`（200），不重複建立。
- 同時新增「同用戶 + 同 plan + 同 billing_cycle + status in (awaiting_info, pending)」的查重：若已有未完成單，直接回傳該單 id 並標註 `reused: true`。

### `Checkout.tsx`
- 進入頁面時用 `useRef` 產生一個 `clientRequestId`（`crypto.randomUUID()`），整個頁面 session 共用一份；點「確認付款」帶上。
- 用 `useRef<boolean>` 的 `submittingRef` 守門：`isProcessing` 之外再加同步鎖，避免快速雙擊在 React 重渲染前重入。
- 失敗時 `resultDialog` 增加「重試」按鈕，重新呼叫同一個 `clientRequestId`（伺服器端冪等保證安全）。

---

## 2. `/account/remittance` 回填表單強化

檔案：`src/pages/account/MyRemittanceOrders.tsx`

- **驗證**（送出前 + onChange 即時提示）：
  - `last5`：剛好 5 位數字（`/^\d{5}$/`），輸入時即時剝除非數字、`maxLength=5`，未達 5 碼時 disable 送出鈕並顯示「需 5 位數字」inline 錯誤。
  - `payerName`：trim 後非空、長度 ≤ 30，否則 disable 送出鈕並顯示錯誤。
- **送出鎖定**：
  - 已有的 `submitting: true` 維持；額外在「送出成功後」把該 order id 加入 `submittedOnce` Set，避免狀態尚未 refetch 完成前再次按下。
  - 送出中按鈕顯示 spinner + 文字「送出中…」並 `disabled`。
- **失敗提示**：toast 增加「重試」動作（重呼 `submit(id)`）。

---

## 3. 匯款訂單狀態追蹤區塊

在每張訂單卡上方/內部新增一個 stepper：

```text
建立訂單 ──▶ 待補匯款資料 ──▶ 待對帳 ──▶ 已開通
 created     awaiting_info     pending     confirmed
                                           （或 rejected 顯示紅色終點）
```

- 元件 `RemittanceStatusStepper`（新檔，`src/pages/account/_remittance/StatusStepper.tsx`）：
  - 接收 `status`，渲染 4 步驟橫向 stepper（rejected 時最後一步以 destructive 顯示「已拒絕」）。
  - 純 presentational，使用 design tokens（`text-muted-foreground`、`text-primary`、`bg-primary`、`border-destructive`）。

- **即時更新**：在 `MyRemittanceOrders.tsx` 訂閱 Supabase Realtime：
  ```ts
  supabase.channel('remittance-orders-self')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'remittance_orders', filter: `user_id=eq.${user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ['remittance-orders', user.id] }))
    .subscribe();
  ```
- migration 中將 `remittance_orders` 加入 `supabase_realtime` publication（若尚未加入）。

---

## 技術細節（給工程師）

### Migration
1. `ALTER TABLE remittance_orders ADD COLUMN client_request_id uuid;`
2. `CREATE UNIQUE INDEX remittance_orders_user_client_req_idx ON remittance_orders(user_id, client_request_id) WHERE client_request_id IS NOT NULL;`
3. `ALTER PUBLICATION supabase_realtime ADD TABLE public.remittance_orders;`（若未加入；加入前先檢查）

### 檔案異動清單
- `supabase/migrations/<ts>_remittance_idempotency.sql`（新）
- `supabase/functions/create-expert-remittance/index.ts`（改：冪等 + reuse 邏輯）
- `src/pages/Checkout.tsx`（改：clientRequestId、submittingRef、重試對話框）
- `src/pages/_checkout/CheckoutResultDialog.tsx`（改：支援 `onRetry` prop）
- `src/pages/account/MyRemittanceOrders.tsx`（改：驗證、鎖定、Realtime、stepper）
- `src/pages/account/_remittance/StatusStepper.tsx`（新）
- `src/test/components/MyRemittanceOrders.test.tsx`（補：驗證與鎖定 case）

### 驗證
- `/checkout/<slug>/<planId>` 選匯款 → 快速雙擊「確認付款」→ 只建立 1 筆訂單。
- 重整頁面（clientRequestId 重生）後再送 → 因「同 plan + 未完成單」查重，返回既有 orderId。
- `/account/remittance` 輸入 `123` 送出 → 按鈕 disabled、顯示錯誤；輸入 `12345` + 姓名 → 送出後按鈕鎖定，狀態自動由 `awaiting_info` → `pending`，stepper 同步更新。

不更動：RLS 政策、`confirm-remittance`、`submit-remittance-info`、其他付款 provider 分支。
