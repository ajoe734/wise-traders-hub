

# LINE@ 訊號推播整合計劃

## 概述

每位分析師擁有一個由公司統一申辦的 LINE Official Account（LINE@）。分析師發布新訊號時，系統自動透過該分析師的 LINE@ 推播通知給已綁定的訂閱者。

## LINE 帳號管理架構

```text
公司 LINE Business ID（所有權歸公司）
  |
  +-- 分析師 A 的 LINE Official Account
  |     操作員：分析師 A（只能回覆訊息）
  |     管理員：公司管理者（掌控設定與 Token）
  |
  +-- 分析師 B 的 LINE Official Account
  |     操作員：分析師 B
  |     管理員：公司管理者
```

- 所有 LINE OA 由公司 Business ID 建立，所有權歸公司
- 分析師為「操作員」，只能回覆訊息
- Channel Access Token 由管理者在系統後台統一設定
- 員工離職移除操作員權限即可，帳號與好友名單保留

## 推播流程

```text
分析師發布訊號 (insert expert_signals)
       |
       v
前端呼叫 Edge Function: line-push-signal
       |
       v
  1. 查 expert_line_channels 取得 channel_access_token
  2. 查 member_line_bindings + member_subscriptions 取得活躍訂閱者 LINE UID
  3. LINE Messaging API multicast 推播 Flex Message
       |
       v
訂閱者 LINE 收到通知
```

## 實作步驟

### 1. 資料庫 — 新增兩張表

**`expert_line_channels`** — 每位分析師的 LINE OA 設定（僅 company_admin 可讀寫）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | uuid PK | |
| expert_id | uuid UNIQUE | FK -> experts.id |
| channel_id | text | LINE Channel ID |
| channel_access_token | text | 長期 Token |
| channel_name | text | 顯示名稱 |
| is_active | boolean | 是否啟用推播 |
| created_at / updated_at | timestamptz | |

**`member_line_bindings`** — 訂閱者的 LINE 綁定（預留，後續用戶加好友時寫入）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid | FK |
| expert_id | uuid | FK |
| line_user_id | text | 該用戶在此 OA 的 UID |
| display_name | text | LINE 顯示名 |
| is_active | boolean | |
| bound_at | timestamptz | |

UNIQUE: (user_id, expert_id)

### 2. Edge Function — `line-push-signal`

- 接收 `{ signal_id, expert_id }`
- 從 `expert_line_channels` 取 token（若無設定回傳 `{ pushed: false, reason: 'no_channel' }`）
- 從 `member_line_bindings` JOIN `member_subscriptions` 查活躍且已綁定的 LINE UID
- 呼叫 `POST https://api.line.me/v2/bot/message/multicast` 推播 Flex Message
- 每批最多 500 人，分批發送
- 回傳 `{ pushed: true, count: N }`

### 3. 前端 — 分析師訊號發布後自動推播

**`src/pages/admin/Signals.tsx`** 的 `handlePublish` 函式：
- 訊號 insert 成功後，呼叫 `supabase.functions.invoke('line-push-signal', { body: { signal_id, expert_id } })`
- 成功 → toast「已推播給 N 位訂閱者」
- 無 LINE 設定 → 靜默跳過（不影響訊號發布）
- 推播失敗 → toast「LINE 推播失敗，訊號已發布」

### 4. 前端 — 公司管理後台 LINE 設定

**`src/pages/company/Analysts.tsx`**：
- 每位分析師操作列新增「LINE」按鈕（與現有「方案」按鈕並列）
- 點擊開啟 Dialog，可設定：
  - Channel ID
  - Channel Access Token
  - 顯示名稱
  - 啟用/停用推播
- 顯示已綁定訂閱者人數

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| DB migration | 新增 | 建立 expert_line_channels 和 member_line_bindings 表 + RLS |
| `supabase/functions/line-push-signal/index.ts` | 新增 | LINE 推播 Edge Function |
| `supabase/config.toml` | 修改 | 新增 line-push-signal 設定 |
| `src/pages/admin/Signals.tsx` | 修改 | 發布訊號後呼叫推播 |
| `src/pages/company/Analysts.tsx` | 修改 | 新增 LINE 設定管理 Dialog |

## 安全性

- Channel Access Token 僅存資料庫（RLS 保護，僅 company_admin）和 Edge Function，前端不接觸
- 推播 API 僅在後端 Edge Function 執行
- 分析師無法查看或修改 LINE Channel 設定

## 前置作業（需人工完成）

1. 用公司 LINE Business ID 為每位分析師建立 LINE Official Account
2. 在 LINE Developers Console 啟用 Messaging API
3. 發行長期 Channel Access Token
4. 在系統後台（分析師管理頁）輸入 Token

