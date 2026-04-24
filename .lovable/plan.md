

# 補齊後台四項缺口

## 範圍

### 1. 分析師後台 - 公告唯讀入口
新增頁面 `src/pages/admin/Announcements.tsx`，路徑 `/admin/:expertSlug/announcements`。
- 唯讀列出公司發布的 `announcements`（status='published'）
- 頁首顯示「公告由公司統一發布，如需協助請聯絡管理員」說明文字
- `AdminLayout` 側邊欄新增「系統公告」項目（Megaphone icon）
- `App.tsx` 註冊路由

### 2. 分析師後台 - 訂閱者頁面 UX 提示
修改 `src/pages/admin/Subscribers.tsx`：
- 每列右側新增 disabled「取消訂閱」按鈕，搭配 Tooltip：「為保障訂閱者權益，僅訂閱者本人可主動取消；如需協助請聯絡公司管理員」
- 頁首加一行 muted 說明文字，避免分析師誤以為功能缺失

### 3. 訊號編輯重推 LINE
修改 `src/pages/admin/Signals.tsx` 編輯流程：
- 編輯 dialog 新增 checkbox「同步重推給 LINE 訂閱者（將標記為「已更新」）」，預設取消勾選
- 勾選並儲存後呼叫 `supabase.functions.invoke('line-push-signal', { body: { signal_id, is_update: true } })`
- 推送成功後 `expert_signals.line_pushed_at` 由 edge function 更新
- 修改 `supabase/functions/line-push-signal/index.ts`：
  - 接受 `is_update: boolean` 參數
  - 訊息前綴改為「🔄 訊號更新通知」（原為「🔔 新訊號」）
  - 維持既有 multicast 與訂閱者篩選邏輯（沿用 `subscriber-push-eligibility` 規範）
  - 寫一筆 `audit_logs`：action='signal_repush', target_type='expert_signal', target_id=signal_id

### 4. 公司後台 - 審計日誌 UI
新增頁面 `src/pages/company/AuditLogs.tsx`，路徑 `/company/audit-logs`。
- 表格欄位：時間、操作者（join `profiles.display_name` / email）、動作、目標類型、目標 ID、詳情（JSON 收合）
- 篩選：動作類型 dropdown（refund_executed / analyst_created / signal_repush / 其他）、日期區間、操作者搜尋
- 分頁：每頁 50 筆，使用 `range()` 而非 1000 筆預設限制
- `CompanyLayout` 側邊欄新增「審計日誌」（FileClock icon），位於「系統公告」之上
- `App.tsx` 註冊路由

## 技術細節

- **資料存取**：所有查詢沿用既有 RLS（`audit_logs` 已限 company_admin、`announcements` 已開放 authenticated 讀 published）
- **UI 元件**：沿用 shadcn `Table`、`Dialog`、`Tooltip`、`Badge`、`Select`、`Pagination`，不引入新依賴
- **Hook**：`useAuditLogs(filters, page)` 與 `useAnnouncementsReadOnly()` 用 React Query
- **Edge Function**：僅修改 `line-push-signal`，不新增函式；維持 `verify_jwt = false`
- **無 schema 變更**：`audit_logs`、`expert_signals.line_pushed_at` 欄位已存在，無需 migration

## 不在範圍內

- 主動取消他人訂閱的後端能力（合規限制，僅補 UX 提示）
- 公告留言／回覆功能
- 審計日誌匯出 CSV（如需可後續另案）
- 訊號編輯歷史版本紀錄（僅推一次更新通知，不存 diff）

## 預期成果

- 分析師後台多 1 頁（公告）+ 訂閱者頁多 1 個提示按鈕 + 訊號編輯多 1 個推播選項
- 公司後台多 1 頁（審計日誌），可追蹤退款／建立分析師／訊號重推等操作
- LINE 推播覆蓋訊號更新場景，沿用既有訂閱者驗證與 multicast 邏輯
- 改動 6 檔（5 個前端 + 1 個 edge function），新增 2 個前端檔，無 DB schema 變更

