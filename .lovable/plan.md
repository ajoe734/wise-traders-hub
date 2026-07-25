## 方向確認

前一版三個修正（fail-closed / auto-enable / 精準頻率）保留為 **Phase 1**。這版再往上加四個結構性優化，把 pipeline 從「不出事」推到「最佳資源利用 + 自我調整」。

---

## Phase 2 優化清單

### 優化 1：Token Bucket 取代日預算

**現況痛點**：`finmind_quota_pools.daily_budget` 每日 00:05 一次性 reset → 台股開盤 09:00 前互動配額被 keep-warm 吃掉；重置瞬間背景 job 瞬間噴發。

**做法**：
- 改 `finmind_quota_pools` schema：`daily_budget → refill_rate_per_min int`、`bucket_max int`、`bucket_current numeric`、`last_refill_at`。
- `finmind_admit` RPC 改為：先按 `now() - last_refill_at` 補 tokens（capped by bucket_max），再嘗試扣 cost。
- 預設參數：
  - interactive：`refill=3/min, max=200`（尖峰爆發但長時穩態受限）
  - keepwarm：`refill=1/min, max=120`
  - backfill：`refill=0.3/min, max=60`
- Migration 保留舊欄位為 view，UI 顯示改為「當前 tokens / 每分補充速率」。

### 優化 2：優先級借用（interactive 可搶 keepwarm）

**現況痛點**：使用者點抽屜卡在 quota_exceeded，同時 keepwarm 桶還滿的，資源錯配。

**做法**：
- `finmind_admit(_pool='interactive')` 若自己桶空，嘗試從 `keepwarm` 桶借（cost=1，記帳 `borrowed_from=keepwarm`）。
- 不允許 keepwarm 借 interactive、也不允許 backfill 借任何 pool（backfill 是 best-effort）。
- Ledger 新增 `borrowed_from text` 欄位，guardian 監控借用率 > 30% 時建議調高 interactive `bucket_max`。

### 優化 3：Upstream 真實 quota 為準（不再猜）

**現況痛點**：本地 counter 與 FinMind 實際剩餘可能漂移；某天上游改配額我們不知道。

**做法**：
- `tw-bsr-finmind-sync` 讀取 FinMind response 的 `X-RateLimit-Remaining`（若無此 header 則從 error body 解 `Requests Quota`）。
- 每次成功回應把 upstream remaining 寫入 `data_source_health.upstream_quota_remaining`（新欄位）。
- guardian 新規則：若 `upstream_quota_remaining < 100` 且本地 buckets 合計仍很滿 → 主動降 interactive/keepwarm refill_rate 到 30%（暫時），並發 alert。
- 隔日 00:05 自動恢復。

### 優化 4：Request Coalescing（同股併發合流）

**現況痛點**：多使用者同一分鐘打開同一支股，`tw-chips-detail` miss 後各自 enqueue 一次 FinMind 呼叫 → 白燒 quota。

**做法**：
- 新增 `finmind_inflight_requests` 表：`stock_id PK, kind, started_at, expires_at (started_at + 30s)`。
- `tw-bsr-finmind-sync` 呼叫上游前先 `INSERT ... ON CONFLICT DO NOTHING RETURNING`；若 conflict 表示已有 in-flight → 等待 rollup 更新（poll 3 次 x 1s）或直接回 `filling`。
- 完成或失敗時 DELETE 該 row。
- 30 秒過期自動 GC（cron 每 5 分鐘或以 `expires_at` 過濾讀取）。
- 前端 5 態機新增顯示 `coalesced` 徽章（可選，debug 用）。

### 優化 5：SLO 驅動的 guardian（不只看 circuit）

**現況痛點**：guardian 條件是「circuit open ≥ 2h」「reject 率 > 80%」，屬於症狀觸發；症狀出現時使用者已受影響。

**做法**：
- 定義 SLO：交易時段（Mon-Fri 09:00-13:30）`chips-detail` P95 latency ≤ 3s、ready 態占比 ≥ 90%。
- 新增 `chips_state_hourly` materialized view 從 GTM 事件（或後端 log）聚合。
- guardian 新規則：若過去 1 小時 ready 占比 < 70% → 提前把 refill_rate 拉高 20%（借未來 24h 配額）並發 alert。
- 需要 `system_kill_switches` 或 pool 表新增 `slo_boost_until timestamptz`，過期自動回落。

---

## Phase 1（前一版三修正，順序調到最前）

保留不變，先做完再進 Phase 2：
1. `finmindAdmission.ts` fail-closed + `failOpen` 選項
2. `finmind_admit` 無論 granted 都寫 ledger
3. guardian 自動 enable（區分 `manual:` 前綴）
4. guardian 10 分鐘 + root cause 條件

---

## 檔案總覽

**Migration**（Phase 2）
- 改 `finmind_quota_pools`：新增 `refill_rate_per_min`、`bucket_max`、`bucket_current`、`last_refill_at`；建 view `finmind_pool_daily_equiv` 供舊 UI 過渡
- 改 `finmind_admit` RPC：token bucket 補充 + 優先級借用
- 改 `finmind_quota_ledger`：新增 `borrowed_from`、`root_cause_hint`
- 新表 `finmind_inflight_requests`（PK stock_id）
- 改 `data_source_health`：新增 `upstream_quota_remaining int`
- 新 materialized view `chips_state_hourly` + refresh cron 每 10 分鐘

**Backend**
- `_shared/finmindAdmission.ts`：token bucket 呼叫、borrow 支援、記錄 root cause
- `_shared/coalesce.ts`（新）：`acquireInflight` / `releaseInflight`
- `tw-bsr-finmind-sync/index.ts`：接入 coalesce、寫 upstream_quota_remaining
- `tw-chips-detail/index.ts`：miss 時檢查 inflight，若有 → 回 `filling`（coalesced）
- `chips-guardian/index.ts`：加入 SLO 規則、upstream quota 規則

**Frontend**
- `src/pages/company/DataSourceHealth.tsx`：Token bucket 顯示（當前 tokens、補充速率、預計耗盡時間）、借用率、SLO 面板、upstream quota 顯示
- `src/checkup/components/freecheckup/ChipsSection.tsx`：`coalesced` 徽章（feature-flag 預設關）

**Test**
- Phase 1：4 組（前版）
- Phase 2：
  - `pr10-token-bucket.test.ts`：補充邏輯、上限、扣 cost
  - `pr10-priority-borrow.test.ts`：interactive → keepwarm 借用、上限、記帳
  - `pr10-coalesce.test.ts`：同股併發只打一次上游
  - `pr10-slo-boost.test.ts`：ready 占比 < 70% 觸發 refill boost、過期自動回落
  - `e2e/chips-coalesce.spec.ts`：兩個 tab 同時開 6274，只看到一次 upstream call

**Docs**
- `docs/ops/chips-pipeline-runbook.md`：更新 §2 關鍵指標（token bucket、借用率、SLO、upstream quota）、§3-B 新處置流程

---

## 執行順序

1. **Phase 1** 完成並上線觀察 3 個工作日
2. Token bucket migration（含向下相容 view）
3. Priority borrow + ledger 欄位
4. Upstream quota 讀取
5. Coalesce 機制（含 inflight 表）
6. SLO materialized view + guardian 規則
7. Dashboard 更新
8. 測試補齊 + runbook 更新
9. CI 綠燈上線

---

## 風險

- **Token bucket 遷移**：舊 `daily_budget` 的認知需在 UI 過渡；提供 view 避免破壞現有查詢。
- **Coalesce race**：`INSERT ON CONFLICT` 保證原子性；30s 過期 + GC 保證不 leak。
- **SLO boost 誤觸**：加入 `slo_boost_until` 上限每日 2 小時，避免無限制放行。
- **Upstream header 不穩定**：header 缺失時 fallback 到本地 counter，不阻斷主流程。
- **借用可能讓 keepwarm 挨餓**：設定 `keepwarm.bucket_current ≥ 30%` 才允許被借。

---

## 不做的部分（明確排除）

- 換掉 Supabase 換 Redis / 專用 rate limiter：現規模不必要，維運成本反而高。
- ML 預測熱門股主動 warm：ROI 太低，Phase 3 再說。
- 分區部署（多 region）：目前使用者集中台灣，用不到。
