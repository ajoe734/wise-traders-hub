# 兩個缺口的處理計畫

## 缺口 A：分析真背景化（可關網頁）

### 現況
`useDailyAnalysisWorkflow.js`（589 行）在前端跑 3 次 `checkup-analyze`：
1. **盲測預測**（L297）：先不看大腦的預測，用來校準命中率
2. **主分析**（L338）：帶入大腦 context 跑完整 daily report
3. **大腦更新**（L440）：把當日結論回寫 brain

外加 `persistAnalysisToCloud` / `flushPendingAnalyses` / `flushKnowledgeHits` 等副作用。關頁面 → 全斷。

### 做法（分兩階段，避免一次搬 589 行）

**Phase 1（本輪做）：worker 化主分析**
- 新增 `checkup-analyze-worker` edge function：
  - 由 `checkup-analyze-enqueue` 用 service role 觸發（fire-and-forget）
  - 讀 `checkup_analysis_jobs.holdings_snapshot`（前端 enqueue 時已快照）
  - 在 function 內依序呼叫 `checkup-analyze` 三次（盲測 → 主分析 → 大腦更新）
  - 完成後寫 `result_summary` + 觸發 `checkup-notify-complete`
- 前端 `useDailyAnalysisWorkflow` 新增「背景模式」分支：
  - 若使用者明確按「背景跑」按鈕 → 呼叫 enqueue 後直接返回，顯示 toast「分析中，可關頁面」
  - 若仍在頁面，透過 Realtime 訂閱 `checkup_analysis_jobs` status 變化，job done 時拉 `result_summary` 渲染（不再前端跑）
- 前端原有的 prompt 組裝邏輯（buildDailyHoldingDossierContext 等）抽到 `_shared/daily-prompt.ts`，worker 與前端共用

**Phase 2（下一輪，非本計畫範圍）**
- brain 更新、knowledge hits flush、persistAnalysisToCloud 完整搬進 worker
- 移除前端 fallback 路徑

### 邊界條件
- Job 超時：worker 設 5 分鐘 hard timeout，超時寫 `failed` + 通知「分析失敗，請重試」
- 重複觸發：enqueue 時檢查使用者當日是否已有 `queued`/`running` job，是則回傳既有 job_id（不重複跑）
- AI 失敗：盲測失敗不阻斷主分析（沿用現有 `blindStatus` 邏輯）；主分析失敗才算 job failed

---

## 缺口 B：Line 推播 fallback

### 現況
`checkup-notify-complete` 借用任一綁定 expert 的 OA token 推播給 `profile.line_user_id`。沒走 Line 登入 / 沒綁 expert 的使用者拿不到 Line，只剩站內 + Email。

### 做法

**1. 加新 secret `PLATFORM_LINE_CHANNEL_TOKEN`（選用）**
- 若你有平台級 OA（legendflow 官方帳號），把 channel access token 存進來
- `checkup-notify-complete` 推播優先序：
  1. `PLATFORM_LINE_CHANNEL_TOKEN`（若存在）→ 推給 `profile.line_user_id`
  2. fallback：使用者綁定的任一 expert OA token（現行邏輯）
  3. 都沒有 → 只送站內 + Email
- 若你還沒有平台 OA，就直接跳過此步，維持現狀（expert OA fallback）

**2. UI 提示綁定 Line**
- `Notifications` 頁 / Account 頁加 banner：「綁定 Line 即可在分析完成時收到推播」→ 連到既有 Line 登入綁定流程
- 已有 `member_line_bindings`，沿用既有 binding code 流程，不另開新表

**3. 通知偏好開關**
- `notification_preferences` 已存在，新增 key `checkup_complete_line` / `checkup_complete_email`，預設 ON
- `checkup-notify-complete` 推播前讀偏好，使用者關閉就跳過該渠道

---

## 要你決定
1. **平台 OA 你有嗎？** 有 → 我建 secret 欄位等你貼 token；沒有 → 只做 fallback banner + 偏好開關
2. **Phase 1 範圍 OK 嗎？** 還是你想一次搬完（包含 brain 更新、knowledge hits），我直接做大工程？

確認後我切 build mode 開工。
