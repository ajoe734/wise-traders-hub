
# 背景收盤分析 + 多通道通知

## 目標流程

```text
[每日 14:00 cron]
  └─ 掃描所有「啟用訂閱 + 持倉≥1」的註冊用戶
     ├─ 綁 Line → Line 推播「今日可跑收盤分析」+ 深連結
     ├─ 未綁 Line → Email + 站內通知
     └─ 無持倉 → 跳過

[使用者點深連結進站]
  └─ 進入 /holding-checkup?autorun=1
     ├─ 自動執行雲端同步（強制 pull 最新持倉）
     ├─ 建立 analysis_job (status=queued)
     └─ 觸發背景 worker → 使用者可關掉網頁

[背景 worker 完成]
  ├─ 寫回 checkup_analysis_results
  ├─ 摘要：總損益、需注意 Top 3
  └─ 通知：Line（綁定者）+ Email + 站內，全部附深連結回結果頁
```

## 一、資料層（新表）

### `checkup_analysis_jobs`
- `user_id`, `status` (queued/running/done/failed), `holdings_snapshot jsonb`, `result_summary jsonb`, `error_text`, `started_at`, `finished_at`
- RLS：使用者只能讀自己的；service_role 可寫
- GRANT SELECT 給 authenticated；ALL 給 service_role

### `checkup_daily_reminders`（去重用）
- `user_id`, `reminded_on date`, UNIQUE(user_id, reminded_on)
- 避免一天重複推播

（不新增 schema 給持倉本身；沿用 `checkup_storage`，「跑分析當下強制同步」由前端 `useCloudSync` 完成）

## 二、Edge Functions

### 新增 `checkup-analyze-enqueue`（取代前端直接呼叫 checkup-analyze）
- Auth required
- 入參：`holdings`, `reversalConditions`, ...（同現行 contract）
- 動作：寫一筆 `checkup_analysis_jobs(queued)` → 回傳 `job_id` → 立刻 fire-and-forget 觸發 worker（用 `EdgeRuntime.waitUntil` 或內呼 worker function）
- 配額：照舊呼叫 `consumeCheckupQuota`

### 新增 `checkup-analyze-worker`
- service_role only（內部呼叫，verify_jwt=false 但驗 shared secret）
- 讀 `checkup_analysis_jobs.id` → status=running → 跑現行 `checkup-analyze` 同一份 AI 流程 → 寫結果 → 觸發 `checkup-notify-complete`
- 失敗：status=failed + error_text，照樣發失敗通知

### 新增 `checkup-notify-complete`
- 入參：`job_id`
- 撈使用者：`profiles` + `member_line_bindings`（沿用 line-push-signal 的綁定查法）
- Line（若綁）：摘要 + 深連結 `https://legendflow.tw/holding-checkup?job={id}`
- Email：用 Resend，沿用 `email-push-renewal-reminder` 樣板手法
- 站內：寫 `notifications` 表

### 新增 `checkup-daily-reminder-cron`
- 每日 14:00 UTC+8（pg_cron 觸發）
- 找出符合條件用戶（active subscription + checkup_storage 有持倉）
- 對每人：upsert `checkup_daily_reminders` (ON CONFLICT DO NOTHING)；INSERT 成功才推播
- 推播分流：Line / Email / 站內

## 三、前端（FreeCheckup.jsx + useDailyAnalysisWorkflow.js）

1. **改 invoke 路徑**：`checkup-analyze` → `checkup-analyze-enqueue`，拿到 `job_id` 後：
   - 顯示「分析已排程，可關閉頁面，完成後將透過 Line / Email 通知」橫幅
   - 開 Realtime subscribe `checkup_analysis_jobs:id=eq.{job_id}` → status=done 自動把結果灌進現有 UI
2. **autorun 深連結**：`?autorun=1` → 進站後執行「強制雲端同步 → 自動按下跑收盤分析」
3. **job 結果回讀**：`?job={id}` → 直接從 `checkup_analysis_jobs.result_summary` 還原顯示
4. **離站保護**：移除「跑分析中不能關頁」的提示（背景化後不再需要）

## 四、通知去重與權限

- Line 推播：沿用 `line-push-signal` 內的「綁 Line 且訂閱有效」邏輯（[Push eligibility](mem://features/notifications/subscriber-push-eligibility)）
- 每日提醒只推一次（`checkup_daily_reminders` UNIQUE 防重）
- 分析完成通知無去重（每次 job 完成都通知，因為是使用者主動觸發）

## 五、不動的東西

- AI 模型選擇與 fallback 順序（`checkup-analyze` 原邏輯整段搬進 worker）
- 配額計算
- 既