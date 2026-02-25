# 投顧管理後台 — 完整整合實作計劃

## 已完成 ✅

### 資料庫
- [x] 9 個 Enum 類型（expert_role, plan_type, review_status, signal_action, signal_status, trade_status, subscription_status, payment_status, provider_type）
- [x] 8 張表（experts, expert_plans, expert_signals, trade_records, member_subscriptions, payment_providers, payment_transactions, audit_logs）
- [x] 完整 RLS 策略（分析師只能存取自己的資料，管理者可存取全部）
- [x] 自動績效 Trigger（訊號發布自動產生 trade_records）
- [x] 績效計算 DB Function（calculate_expert_performance）

### Edge Function
- [x] create-analyst（管理者建立分析師帳號）

### 前端頁面
- [x] 分析師方案管理頁 `/admin/:slug/plans`（建立/送審方案）
- [x] 分析師訊號管理頁（改為接 DB，發布即上線）
- [x] 分析師績效總覽（改為唯讀，接 DB）
- [x] 管理者分析師管理（新增分析師 Dialog + 停用/啟用，接 DB）
- [x] 管理者金流管理頁 `/company/payments`（金流工具設定 + 交易紀錄）
- [x] 管理者內容審核（方案審核 + 內容監管雙 Tab，接 DB）
- [x] 管理者訂閱者管理（到期日/剩餘天數/續訂率/續訂模式，接 DB）
- [x] 管理者營收數據（接 DB）
- [x] 管理者總覽（接 DB）

### 導航與路由
- [x] AdminLayout 新增「方案管理」
- [x] CompanyLayout 新增「金流管理」
- [x] App.tsx 新增 2 條路由

---

## 後續階段（未實作）

### 帳號安全偵測
- [ ] `user_sessions` 表（user_id, session_id, device_info, ip_address, last_active_at, is_active）
- [ ] Database Trigger：新 session 建立時自動將同 user_id 其他 session 標為 inactive
- [ ] 前端被踢掉時顯示「您的帳號已在其他裝置登入」
- [ ] 訂閱者管理頁擴充：每個訂閱者顯示「目前裝置」、異常帳號標記、管理者可手動強制登出
- [ ] 規則：僅限 1 個裝置同時登入
