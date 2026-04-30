# 全部執行：設定重組 + 審計日記改造

兩件事一次到位。先做設定頁重組（小、快、馬上看得到），再做審計日記全面改版（重點工程）。

---

## A. 設定頁面重組

### A1. 跨產品折扣 → 移到方案管理

- 在 `src/pages/company/Plans.tsx` 新增分頁/區塊「跨產品折扣」
- 搬移 4 個欄位：`has_checkup_basic_discount_on_expert`、`has_checkup_pro_discount_on_expert`、`has_expert_discount_on_checkup_basic`、`has_expert_discount_on_checkup_pro`（金額 NT$）
- 寫入 `payment_settings.cross_discounts`（沿用既有 key，不動結構）
- `PaymentSettings.tsx` 移除此區塊

### A2. 匯款帳戶 → 移到金流工具

- 在 `src/pages/company/Payments.tsx` 新增第三張卡片：「匯款（ATM/臨櫃）」
- 設定 dialog 欄位：銀行名稱、銀行代碼、帳號、戶名、備註
- 寫入 `payment_settings.remittance_account`
- `PaymentSettings.tsx` 移除此區塊
- 這只是「收款帳戶展示資料」設定，匯款訂單審核仍在 `/company/remittance`（不混淆）

### A3. 收款設定 → 改名「分潤設定」

- `PaymentSettings.tsx` 只保留：平台/分析師分潤比例（預設 + 方案級覆寫表 `plan_split_overrides`）
- 側邊欄 `CompanyLayout.tsx` label：「收款設定」→「分潤設定」
- 路由 `/company/payment-settings` 不動（避免破壞舊連結）

---

## B. 審計日記全面改版

現況確認：DB 內 99% 是 `stock_price_sync`(203) / `daily_performance_update`(33) / `daily_snapshot`(14) 等 cron 噪音；人工操作只有 3 筆（refund / create_analyst / update_credentials）。**問題就是「該記的沒記、不該記的塞滿」**。

### B1. 噪音分離（migration）

- 新增 `system_jobs_log` 表（同結構：`job_name / status / detail / ran_at`），給 cron 用
- 改寫 cron edge functions（`stock-price-sync`、`update-daily-performance`、`daily-snapshot-cron`、`mentor-journal-publisher` 等）改寫入 `system_jobs_log`
- `audit_logs` 從此只給「人」用
- 一次性 SQL：把舊的 system action 從 `audit_logs` 搬到 `system_jobs_log`（保留歷史）

### B2. 標準化記錄工具

新增 `src/lib/auditLog.ts`：

```ts
logAdminAction({
  action: 'plan.approve',           // namespace.verb
  targetType: 'expert_plan',
  targetId: planId,
  detail: {
    before: {...}, after: {...},
    context: { reason: '...' }
  }
})
```

規範 namespace：`plan.* / payment.* / subscription.* / analyst.* / announcement.* / signal.* / setting.* / remittance.*`

### B3. 補齊人工操作記錄點

在這些頁面/動作呼叫 `logAdminAction`：

| 頁面 | 動作 |
|---|---|
| Plans.tsx | `plan.approve / plan.reject / plan.toggle_active / plan.cross_discount_update` |
| PaymentSettings.tsx | `setting.split_default_update / setting.split_override_upsert` |
| Payments.tsx | `setting.payment_provider_toggle / setting.remittance_account_update` |
| Remittance.tsx | `remittance.confirm / remittance.reject` |
| Subscribers.tsx | `subscription.admin_adjust / subscription.refund / subscription.cancel` |
| Announcements.tsx | `announcement.publish / announcement.delete` |
| Analysts.tsx | `analyst.create / analyst.suspend / analyst.activate / analyst.update_credentials` |
| Signals (admin 介入) | `signal.admin_takedown` |

### B4. UI 全面重做（`AuditLogs.tsx`）

替換現在的版本：

- **動態篩選器**：從 DB `SELECT DISTINCT action, target_type` 動態組出，不再 hardcode
- **時間範圍**：今天 / 7 天 / 30 天 / 自訂
- **操作者篩選**：下拉選 admin
- **人話描述**：`formatAuditAction(log)` 把 `plan.approve` + detail 翻成「核准方案《XXX》（分析師：王小明）」
- **Before / After diff**：左右兩欄 key-by-key 對照，差異紅綠標示（用台股慣例：紅=新值、綠=舊值會混淆，這裡改用中性藍/灰）→ 改用 **灰=before、橘=after**（避開漲跌色衝突）
- **資源連結**：每筆 log 右側「→ 前往」按鈕直達該 plan / subscription / announcement
- **匯出 CSV**：篩選後的結果可下載

### B5. 系統工作監控（次要）

新增 `/company/system-jobs` 頁（純檢視）顯示 `system_jobs_log`，給 dev 看 cron 是否正常。側邊欄放在「審計日記」下面，較不顯眼。

---

## 執行順序

1. **A1+A2+A3 設定重組**（1 次 commit，純前端 + payment_settings key 沿用）
2. **B1 migration**（新表 + 資料搬移）
3. **B2 helper + B3 instrumentation**（一次串完所有人工操作點）
4. **B4 UI 重做**（AuditLogs.tsx 整個換）
5. **改寫 cron edge functions** 寫入 system_jobs_log
6. **B5 system-jobs 監控頁**

---

## 不做的事（明確排除）

- 不改 audit_logs schema 既有欄位（`action / target_type / target_id / detail / actor_id` 已夠用）
- 不加 RLS 改動（既有 company_admin only 已正確）
- 不為了 diff 而強制所有舊 detail 補 before/after（舊資料保持原樣，formatter 容錯）
- 不動 `/company/remittance` 訂單審核頁（匯款帳戶設定 ≠ 匯款訂單審核，分清楚）

確認 → 我直接全部做完。
