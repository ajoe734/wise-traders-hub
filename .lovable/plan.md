## 目標

把「持股看板（健檢）」加入後，後台 14 個頁面散落的缺口一次補齊。三大類：
1. **數據缺漏**：Dashboard / Subscribers 不認 `checkup_subscriptions`
2. **流程斷鏈**：退款只改狀態沒呼叫真退款 edge function
3. **UX/可讀性**：匯款、稽核、系統任務缺 label / 健檢欄位顯示

---

## 改動範圍

### 🔴 P0 — 數據完整性

**1. `src/pages/company/Dashboard.tsx`**
- `fetchStats` 加查 `checkup_subscriptions` (active+auto_renew) 與 `checkup_plans`
- MRR：原本只算 expert 訂閱 → 加上健檢月/年訂閱換算月費
- 本月新增訂閱 / 取消訂閱 / 續訂率：UNION 兩個 subscriptions 表
- 新增一張卡：「本月健檢訂閱數」與「健檢 MRR」獨立顯示，避免混在一起看不到趨勢

**2. `src/pages/company/Subscribers.tsx`**
- 改成同時抓 `member_subscriptions` 與 `checkup_subscriptions`，合併渲染
- 表格新增「類型」欄：訂閱方案 / 健檢方案
- 篩選器加「類型」filter（全部 / 訂閱 / 健檢）
- CSV 匯出包含類型欄位
- profile 一次查兩邊的 user_id 聯集

**3. `src/pages/company/Revenue.tsx` `handleRefund`**
- 在 `update payment_transactions.status='refunded'` 之前，先呼叫對應 edge function 真退款：
  - 看 `provider_id` → providers map → `provider_type`
  - `acpay` → `supabase.functions.invoke('acpay-refund', { body: { tx_id, reason } })`
  - `ecpay` → 呼叫 `process-refund`（此 function 已存在）
  - `linepay` → 暫不支援，UI 禁用 + tooltip 說明
- edge 失敗 → toast 報錯並中止，不寫 DB 狀態
- 成功 → 反沖 `revenue_splits`：將該交易對應的 split 標 `refunded_at` 或寫入沖銷 row（看現有 schema，由實作時決定）
- 移除 Revenue.tsx L427「退款獨立顯示，因為 acpay-refund 只更新…」這條註解（修好就不必再講）

### 🟠 P1 — 防呆 / UX

**4. `src/pages/company/Remittance.tsx`**
- 卡片補欄位：方案名稱（join `expert_plans` 或 `checkup_plans`）、`original_amount` + `discount_amount` + `discount_reason`（若有折扣以「原價 → 折後」呈現）
- `expired` 狀態獨立 badge 顏色（與 rejected 區分）
- `confirmed` 顯示 `confirmed_at` 與 `confirmed_by`（admin 名稱）

**5. `src/lib/auditLog.ts` ACTION_LABELS**
- 補 `plan.checkup_create / checkup_update / checkup_delete / checkup_activate / checkup_deactivate` 中文 label
- 補 `payment.refund_failed`、`remittance.expired`（自動過期）
- `TARGET_TYPE_LABELS` 加 `checkup_plans` → 健檢方案、`checkup_subscriptions` → 健檢訂閱

**6. `src/pages/company/AuditLogs.tsx` TARGET_LINK**
- 加 `checkup_plans: () => '/company/plans'`
- 加 `checkup_subscriptions: () => '/company/subscribers'`
- `describe()` 補 `ctx.name`（健檢方案沒有 plan_name 只有 name）

**7. `src/pages/company/SystemJobs.tsx`**
- 加 `JOB_LABELS` map 把 `stock-price-sync`、`expire-stale-remittance`、`checkup-price-refresh`、`mentor-journal-publish`、`announcement-cleanup` 翻成中文＋簡述
- 表格「任務」欄顯示中文，hover/小字保留原 job_name

### 🟡 P2 — 安全（小）

**8. `payment_settings` masked view**（migration）
- 建 `payment_settings_safe` view（SECURITY INVOKER），把 `value` 中的 HashKey/HashIV/MerchantID 等敏感欄位以 `***last4` 呈現
- `PaymentSettings.tsx` 與其他唯讀地方改讀 safe view；寫入仍走 `payment_settings`（admin RLS）
- 即使 admin 誤把 service key 灌進前端 console，也只會看到 mask 後的字串

---

## 不在本輪做（避免無限延伸）

- `revenue_splits` 反沖的具體 schema 設計如果現有沒有 `refunded_at` 欄位，會在實作時補一個 migration（只加欄位＋index）
- `linepay-refund` edge function（目前 LINE Pay 沒有退款流程，UI 先禁用）
- 通知中心、KPI 圖表的健檢拆色塊（Revenue.tsx 已有 `checkupGross`，可直接 surface 到 Dashboard，列入 P0 #1）

---

## 驗收

- Dashboard MRR ≧ Expert MRR + Checkup MRR（手算對得起來）
- Subscribers 頁可看到只有健檢方案的會員，篩選器可切換
- 點 Revenue「退款」按鈕能在 edge function logs 看到 `acpay-refund` / `process-refund` 真的被打
- AuditLogs 的健檢相關 row 顯示中文 + 可點連結到 /company/plans
- 匯款卡片可看到「健檢/專家」+ 方案名稱 + 折扣資訊
- SystemJobs 任務名稱顯示中文
