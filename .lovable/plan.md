## 目標
針對先前免費收盤分析配額被誤扣的 13 位 LINE 登入用戶，盡可能透過 LINE 推播道歉訊息；無法觸及者以站內公告補上。

## 道歉文案（請審）
標題：`【legendflow】免費收盤分析異常 — 致歉與已補償 1 次`

內文：
```
您好，

先前您使用 LINE 帳號登入並嘗試「免費一次收盤分析」時，因系統異常導致：
分析結果未成功產出，配額卻被扣抵，造成您無法再次使用。

我們已完成以下處理：
1. 已修復扣抵邏輯，未來不會再發生相同情況
2. 已將您的「免費一次收盤分析」額度重置 +1 次

請重新登入後至「我的服務」確認，再次嘗試免費分析。
造成困擾，誠摯致歉。

— legendflow 團隊
```

文末附登入連結 `https://legendflow.tw/auth/login`。

## 技術細節

### 1. 新增一次性 Edge Function `apologize-line-free-quota`
路徑：`supabase/functions/apologize-line-free-quota/index.ts`，`verify_jwt = true`，僅 `company_admin` 可呼叫。

流程：
1. 驗證呼叫者具 `company_admin` 角色（否則 403）
2. 從 `profiles` 撈出 13 位 `line_user_id IS NOT NULL` 的目標清單
3. 從 `expert_line_channels` 撈出全部 `is_active = true` 的 OA（含 `channel_access_token`、`channel_name`）
4. 對每位 `line_user_id` × 每個 OA，呼叫 `POST https://api.line.me/v2/bot/message/push`，body 為 text message
   - HTTP 200 → 標記該用戶為「已送達 via {channel_name}」並 break（同一人不重複 push）
   - 非 200（403/400 表示非好友）→ 記下原因，繼續試下一個 OA
5. 全 3 OA 都失敗者 → 收集到 `unreachable[]`
6. 把成功/失敗結果寫入 `audit_logs`（action=`apologize_line_free_quota`，含 user_id、line_user_id、delivered_via 或 fail_reasons）
7. 回傳 JSON：`{ total, delivered, unreachable_user_ids, details[] }`

### 2. 站內公告 fallback
針對 step 6 中 `unreachable` 的用戶，於相同 Edge Function 末段以 service_role 寫入 `system_announcements`（或現有公告機制），以 `target_user_ids` 鎖定該批用戶；標題與內文同上述道歉文案，登入後於 `/app` 首頁可見。

（需先確認 `system_announcements` 是否支援 user-scoped targeting；若僅支援全站，改為 `notifications` 表逐人寫入。）

### 3. 管理員觸發入口
在 `src/pages/company/CheckupQuotaAudit.tsx` 已存在的「LINE 免費配額重置」區塊下方新增一顆按鈕「補寄道歉通知（13 位）」，confirm dialog 後呼叫上述 Edge Function，回傳結果用 toast 顯示 `送達 X / Y，未觸及 Z 人改用站內公告`。

### 4. 驗證
- 部署後先以 dry-run 模式跑一次（query param `?dry_run=1`，只列出將要 push 的 (user, OA) 組合不實際呼叫）
- 確認組合數為 13 × 3 = 39
- 正式執行後讀 edge function logs 確認每筆 LINE API 回應碼
- 查 `audit_logs` 驗證 13 筆紀錄齊全

## 不做的事
- 不對 LINE 登入虛擬 email (`line_xxx@line.local`) 發 Resend 信件
- 不重發已成功配額重置的 `reconcile_line_free_quota`（先前 migration 已完成）
- 不變更 `is_line_friend` 偵測邏輯