# Build 1f Final Plan v6.2（Production Stage / Stage B）

狀態：**可批准 Stage B deployment**。自然 gate 仍需事後等待，Build 2 仍 blocked。

Stage A commit `dcc44699` 已 PASS，工作樹乾淨。已 read-only 複核：production `claim_bsr_queue_jobs` 仍為 pre（`9b12fcc4…` / `bf25e3de…`），migration `20260812211500` count = 0，cron job 106 (`2 * * * *`)、107 (`7 * * * *`) 皆 active。

## 1. 本次唯一檔案變更

只改 `supabase/tests/fixtures/bsr_claim_expected.tsv` 兩行：

```
post	prosrc	c28474cca7be420355edeefd6207104b
post	functiondef	9180cf172f8f5e7be5af7aa789cfe48d
```

其餘 Stage A files（canonical SQL、sha256、migration、SQL test、equivalence script、lib.ts、index.ts、lib_test.ts）**一律不得再改**。驗收條件：`git diff --stat` 僅此一檔、`+2/-2`；canonical sha256 仍為 `a55fb89e…`；canonical ⇄ migration equivalence 仍為 `c28474cc…` / `9180cf17…`。

## 2. 更新 expected 後的 local re-run（全部須列真實 exit code）

| 項目 | 期望 exit |
|---|---|
| `scripts/bsr-claim-equivalence.sh`（含 T1–T6、T5 BRANCH_A=1/BRANCH_B=1） | 0 |
| NC1 / NC2 / NC3 deterministic negative | nonzero（各為 3） |
| Build 1e 9+12 closure regression（含 write + negative） | 0 |
| `deno check index.ts` | 0 |
| `deno test lib_test.ts`（正向） | 0 |
| `BSR_PARTITION_IMPL=reversed deno test lib_test.ts` | nonzero |
| `degrade_signal_test.ts` / `enqueue_filter_test.ts` / `manual_and_source_test.ts` / `queue_simulator_test.ts` | 0 |

任一不符：立即停止，**不碰 production**，回報實際輸出。

## 3. 部署避讓窗

- 禁止變更窗：Taipei 每小時 **:58 → 下一小時 :12**。
- 批准當下若落在窗內：只做 read-only 確認 job106/107 狀態，等到 :12 之後再動。
- 套用前必檢：`cron.job_run_details` 無 job106/107 `status='running'`；`net._http_response` / `net.http_request_queue` 無對應未完成 request。
- migration + Edge deploy + read-back 必須在下一個 :58 前有足夠時間（預留 ≥ 20 分鐘）；不足則等下一窗。
- **不得** 取消 cron job、不得手動觸發 job/worker/Edge。

## 4. Production preflight（唯讀快照）

1. `claim_bsr_queue_jobs`：`md5(prosrc)`、`md5(pg_get_functiondef)`、identity args、`proowner`、`prosecdef`、`proconfig`、`provolatile`、`proacl`、`prolang`、return type。
2. recovery / budget / metrics 相關函式與 `is_tw_trading_hours` 的 prosrc/functiondef hash（後者須等於 expected `inv` 行 `77dc7407…` / `9da38e98…`）。
3. cron job 106/107 的 `active` / `schedule` / `command`。
4. `tw-bsr-finmind-sync` remote version 與 source identifier（deploy 前基準）。
5. `schema_migrations` 內 `20260812211500` count = 0。

**任一 pre drift → 立即停止，不套用。** 同時完整保存 old canonical function body（`pg_get_functiondef` 全文）作為 rollback 素材。

## 5. Apply migration + read-back

- 只套用唯一 migration `20260812211500_bsr_claim_token_slot.sql`（單一 `CREATE OR REPLACE FUNCTION`，不含 GRANT / 不含 DML）。
- 立刻 read-back 並 assert：
  - `md5(prosrc)` = `c28474cca7be420355edeefd6207104b`（主 gate）
  - `md5(pg_get_functiondef)` = `9180cf172f8f5e7be5af7aa789cfe48d`（次 gate）
  - owner / proacl / prosecdef / proconfig / provolatile / identity args 與 pre **完全相同**
  - 其他函式 hash、cron job 定義 **零變動**
- 任何 mismatch → 立刻以已保存 old canonical body 執行 `CREATE OR REPLACE` rollback，read-back 驗回 `9b12fcc4…` / `bf25e3de…`，**禁止 Edge deploy**，回報並停下。

## 6. Edge deploy gate

- DB gate 通過後，**只** deploy `tw-bsr-finmind-sync`。不 deploy 其他 Edge、不 Publish。
- read-back：remote version 遞增；remote source 對應 local `lib.ts` (`300a1f29…`) / `index.ts` (`01b4f5b9…`)；response JSON 欄位集合仍為 139 keys、added=0 / removed=0。
- 失敗或 source mismatch → 先回退 Edge 至 pre version/source，再 rollback DB 至 pre function，兩端 read-back 驗證；**不得留 partial state**。

## 7. 成功後 production 變更帳

- 人為 DML = **0**。
- 僅 1 個 `CREATE OR REPLACE` DDL + 1 次指定 Edge deploy。
- `supabase_migrations.schema_migrations` 新增一列與平台必要 metadata **另列說明**，不冒充業務 DML。
- 再 read-only 確認：cron（106/107 schedule/active/command）、ACL（`anon`/`authenticated` 對 recovery 函式無 EXECUTE）、其他 Edge version、Build 1e 9+12 closure 皆未變。

## 8. 自然證據 gate（部署後不得手動驗證）

- **Open window**：連續 3 輪，每輪
  1. `:02` job106 恰 1 筆 audit 且有 `tokened_job_id`
  2. 其後自然 `:07` job107 的 `jobs[]`（completion order）含該 id
  3. 該筆 per-job `rows_written > 0`
  4. 對應 `stock_id` + `trade_date` 有 fact delta
- **Exhausted window**：連續 ≥ 3 輪 HTTP 200、`jobs_quota_deferred > 0`、`rows_written = 0`、無非預期寫入。
- 每輪需在 6 小時內回讀（避免 pg_net 清除）。少一輪即 **PENDING**。

## 9. 邊界

- cron request correlation 維持 UNKNOWN / best-effort，**不修改** `cron_edge_call`。
- freshness coverage 獨立記為 FAIL，不併入本 gate。
- 只有 Build 1 的 scheduler + exhausted + open 三項全 PASS 後，才可進入 Build 2 Plan。Build 2 目前 **blocked**。

## 10. 技術細節：rollback / 順序 / partial-failure 矩陣

執行順序：
```text
freeze-window check → local expected edit → local re-run 全綠
→ production preflight snapshot（含 old body 保存）
→ apply migration → DB read-back gate
→ Edge deploy → Edge read-back gate
→ post-invariant read-only recheck → 停下等自然證據
```

Rollback SQL（DB 端，唯一形式）：
```sql
-- 以 preflight 保存的 pg_get_functiondef(oid) 全文逐字重放
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(...)  -- old canonical body
...
-- 驗回
SELECT md5(prosrc), md5(pg_get_functiondef(oid))
FROM pg_proc WHERE proname = 'claim_bsr_queue_jobs';
-- 必須 = 9b12fcc4eb311794423ddab603dbff8c / bf25e3deaefe24ee761e95e2e6d75391
```

Partial-failure 矩陣：

| 失敗點 | 動作 | 終態 |
|---|---|---|
| local re-run 任一紅 | 停 | repo 保留 expected 編輯，production 未動 |
| preflight drift | 停 | production 未動 |
| migration apply 失敗 | 無需 rollback（DDL 原子） | pre 狀態，Edge 未 deploy |
| DB read-back hash mismatch | DB rollback + 驗回 pre | pre 狀態，Edge 未 deploy |
| Edge deploy 失敗 | Edge 回退 pre version → DB rollback | 兩端皆 pre |
| Edge source mismatch | 同上 | 兩端皆 pre |
| 自然 gate 未達 3 輪 | 不 rollback，標 PENDING | 已部署，等後續輪次 |

Material files：

| 檔案 | 動作 |
|---|---|
| `supabase/tests/fixtures/bsr_claim_expected.tsv` | 修改 2 行（post hashes） |
| 其餘 Stage A files | 不動 |
| production DB | 1 × DDL |
| `tw-bsr-finmind-sync` | 1 × deploy |
