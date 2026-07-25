
# PR-8 & PR-9 規劃（重排版）

前面已完成的「PR-8 上游熔斷 UI 整合」重新編號為 **PR-8.5**（保留在 codebase，不動）。以下 PR-8 與 PR-9 是你剛指定的新範圍。

---

## PR-8：FinMind Quota 三 Pool + Admission Control

### 問題
FinMind 免費/付費 quota 有限，目前所有請求（keep-warm、新股 fastlane、使用者觸發、backfill）共用同一個匿名 pool，忙時互相排擠：
- 使用者剛加的持倉會被 60 日 backfill 塞爆而遲遲取不到 D-1
- keep-warm 用光配額，交易時段的 on-demand 查詢無 quota 可用
- 沒有 admission control，超額後上游回 402/429，circuit breaker 才熔斷，浪費一次失敗

### 目標
把 FinMind 配額切成三個獨立 pool，各自有預算與優先權，超額直接在 admission 層擋下，不打上游、不觸發熔斷。

### 三 Pool 設計

| Pool | 用途 | 每日預算（可調） | 優先權 | 超額行為 |
|---|---|---|---|---|
| `interactive` | 使用者點開抽屜、on-demand fetch | 40% | 高 | 立即回 `quota_exceeded`，UI 顯示「今日查詢額度已用完」 |
| `keepwarm` | 三波 cron、每日收盤同步 | 40% | 中 | 排入下一波，不呼叫 |
| `backfill` | 新股 fastlane、60 日回補 | 20% | 低 | 延後到隔日視窗 |

預算來源：`data_source_health.p95_latency_ms` 隔壁欄位新增 `quota_daily_budget`，或改用新表 `finmind_quota_pools`（採後者，見下）。

### 檔案異動

**Migration**
- 新表 `public.finmind_quota_pools`：`pool_name text PK`、`daily_budget int`、`used_today int`、`reset_at date`、`priority int`、`last_reject_at timestamptz`、`updated_at`
- 新表 `public.finmind_quota_ledger`：`id`、`pool_name`、`request_kind`、`stock_id`、`granted boolean`、`reason`、`created_at`（7 日保留，for audit）
- RPC `finmind_admit(_pool text, _cost int default 1) returns jsonb`：atomic UPDATE，回傳 `{ granted, remaining, reset_at }`
- RPC `finmind_pool_reset()` cron 每日台灣 00:05 呼叫，重置 `used_today`
- RLS：只允許 service_role 寫、company_admin 讀
- GRANT 齊備

**Shared**
- `supabase/functions/_shared/finmindAdmission.ts`：
  - `admit(supa, pool, opts)` → `{ granted, reason }`
  - 呼叫前先 `checkCircuit`（open 直接拒），再 `finmind_admit` RPC
  - reject 時寫 `finmind_quota_ledger` reason=`quota_exceeded|circuit_open`
- 每個呼叫點傳入 pool 標籤：
  - `tw-bsr-finmind-sync` 三波 → `keepwarm`
  - `tw-bsr-finmind-sync` fastlane / new-stock → `backfill`
  - `tw-chips-detail` on-demand 觸發的 enqueue → `interactive`

**Frontend**
- `/company/data-source-health` 新增「FinMind Quota 三 Pool」卡片：顯示每個 pool 的預算/已用/剩餘/reset 時間、最近拒絕原因
- 支援管理員即時調整 `daily_budget`（RPC `finmind_pool_set_budget`）

**測試**
- `src/test/unit/pr8-finmind-admission.test.ts`：
  - 三 pool 各自扣配額
  - 超額後 `granted=false`
  - reset 後恢復
  - circuit open 時 admission 直接拒
  - interactive pool 用完不影響 keepwarm

### 驗收
- 手動把 `interactive.daily_budget=1`，第二次點開持倉抽屜 → 5 態機顯示 `upstream_outage` + 文案「今日互動查詢額度已用完」
- keepwarm cron 仍可跑；backfill 不受影響
- `data_source_health` 熔斷器保持獨立，兩者串接不打架

---

## PR-9：測試金字塔 + Runbook + 上線熔斷

### 問題
PR-3 ~ PR-8 累積 8 個 edge functions、5 張新表、3 個 cron、2 個 admission 系統。目前只有零散 unit test，缺：
- Integration test：跨 edge function + DB 的合約測試
- E2E：使用者從加持倉到看到分點的完整流程
- Runbook：SRE 半夜被叫起來能一頁看完怎麼處理
- 上線熔斷：任一關鍵指標破線自動停 cron，避免半夜燒 quota

### 三層測試金字塔

**Base：Unit（已有 30+）**
補齊缺口：
- `pr9-quota-admission-boundary.test.ts`：3 pool 邊界（0、1、預算-1、預算、預算+1）
- `pr9-chips-state-matrix.test.ts`：5 態 × 3 error kind × 2 circuit state 的完整矩陣
- `pr9-rollup-idempotency.test.ts`：`tw_chips_rollup` 重複 upsert 不改變結果

**Middle：Integration（新增）**
`src/test/integration/chips-pipeline.test.ts`：
- Mock supabase client + FinMind fetch
- 場景 1：新股加入 → fastlane admission → rollup 寫入 → chips-detail 讀到
- 場景 2：quota exhausted → chips-detail 回 upstream_outage state
- 場景 3：circuit open → 所有 pool admission 全拒
- 場景 4：D-1 fallback → chips-detail 回 d1_fallback + 正確 reason

**Top：E2E（新增）**
`e2e/chips-full-pipeline.spec.ts`：
- 登入 → 加持倉 2330 → 開抽屜 → 15 秒內看到 ready state
- 加持倉 9999（不存在）→ 抽屜顯示 filling → 30 秒後顯示 no_data
- Mock circuit open → 抽屜顯示熔斷文案
納入 `.github/workflows/full-tests.yml`。

### Runbook（新增 `docs/ops/chips-pipeline-runbook.md`）
單頁，涵蓋：
1. **架構圖**（ASCII）：使用者 → chips-detail → rollup → keep-warm → FinMind → circuit → admission
2. **關鍵指標**（Grafana/後台頁 URL）：quota 剩餘、circuit state、rollup lag、5 態分布
3. **常見告警與處置**：
   - circuit `finmind_bsr` open > 30 分鐘 → 手動 reset + 檢查 FinMind 官方狀態
   - `interactive` pool 連續 3 天 08:00 用完 → 調高 budget 或購買 quota
   - `keep-warm` 第三波（19:30）未執行 → 檢查 pg_cron `job_run_details`
   - rollup lag > 2 交易日 → 手動觸發 backfill
4. **上線/降級開關**：一鍵 disable 各 cron 的 SQL
5. **升級 FinMind 方案 checklist**：切換 token、bulk API 啟用、budget 重算

### 上線熔斷（Kill-Switch）
新表 `public.system_kill_switches`：
- `key text PK`（如 `chips_keepwarm`, `chips_backfill`, `chips_interactive`, `chips_all`）
- `enabled boolean default true`
- `disabled_reason text`、`auto_trigger_metric text`、`updated_at`

Edge function 進場前先 `check_kill_switch(_key)`：關閉時直接 short-circuit。

**自動觸發規則**（新 edge function `chips-guardian`，每 5 分鐘 cron）：
- 若 `finmind_bsr` circuit 連續 2 小時 open → 自動 disable `chips_keepwarm`
- 若當日 `finmind_quota_ledger` reject 率 > 80% → 自動 disable `chips_backfill`
- 觸發時寫 `system_alerts` + Line push 給管理員

**後台 UI**：`/company/data-source-health` 底部新增 kill-switch 開關列表，管理員可手動切換。

### 檔案清單

**Migration**
- `finmind_quota_pools`、`finmind_quota_ledger`、`system_kill_switches`
- RPC：`finmind_admit`、`finmind_pool_reset`、`finmind_pool_set_budget`、`check_kill_switch`、`toggle_kill_switch`

**Backend**
- `supabase/functions/_shared/finmindAdmission.ts`（新）
- `supabase/functions/_shared/killSwitch.ts`（新）
- `supabase/functions/chips-guardian/index.ts`（新）
- 修改 3 個 edge functions 接入 admission + kill switch

**Frontend**
- `src/pages/company/DataSourceHealth.tsx`：新增 Quota Pool 卡片、Kill-Switch 面板

**Test**
- 3 個 unit、1 個 integration、1 個 e2e（見上）

**Docs**
- `docs/ops/chips-pipeline-runbook.md`

**Cron**
- `chips-guardian` 每 5 分鐘
- `finmind_pool_reset` 每日 00:05 Asia/Taipei

### 驗收
- 手動 disable `chips_keepwarm` → 下一波 cron log 顯示 `skipped_by_kill_switch`
- 手動塞 finmind_bsr circuit `disabled_until` = 3 小時後 → 5 分鐘內 guardian 自動 disable keepwarm + 寫 alert
- Runbook 走一次：從告警到手動 reset 全流程 < 5 分鐘
- CI full-tests 綠燈

---

## 執行順序

**PR-8**
1. Migration（三表 + 4 RPC）
2. `finmindAdmission.ts` shared module
3. 接入 3 個 edge functions
4. `/company/data-source-health` 新增 Quota Pool 卡片
5. Unit test 5 case

**PR-9**
1. Migration（`system_kill_switches` + 2 RPC）
2. `killSwitch.ts` + `chips-guardian` edge function
3. Kill-switch 接入所有相關 edge functions
4. 補齊 unit test + 新增 integration + e2e
5. 撰寫 runbook
6. `/company/data-source-health` 新增 Kill-Switch 面板
7. 手動走一次 runbook + CI 綠燈

---

## 風險與邊界

- **RPC 並發**：`finmind_admit` 用 `UPDATE ... RETURNING`，Postgres row lock 保證 atomicity，不會超發
- **時區**：pool reset 用 Asia/Taipei 日界，避開 UTC 造成台灣 08:00 才 reset 的窘境
- **Kill-switch 誤觸**：guardian 觸發前先寫 `system_alerts` 5 分鐘冷卻，避免 flap
- **Runbook 版本漂移**：加 CI 檢查 runbook 中提到的 RPC/table 名稱必須存在
- **E2E flakiness**：mock FinMind response 走 MSW，不打真上游
