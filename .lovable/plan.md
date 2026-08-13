# Stage R — P5 補證（唯讀查證結果 ＋ 收斂方案）

只讀比對三個 surface 完成。以下先列查證事實，再列建議定案。**未實作任何變更、未 deploy、未 invoke、未寫入 production。**

## 1. 查證結果（事實）

### Surface 1：deploy 前 21:07 自然 body（`net._http_response` id 242197）
- top-level 23 keys：`batch, claimed, degrade_after, degrade_mode, elapsed_ms, job_ids, jobs, jobs_failed, jobs_partial, jobs_quota_deferred, jobs_succeeded, ok, policy, processed, rate_limit_after, rate_limit_before, recycled_reservations, results, rows_written, snapshot_fulfilled, stopped_by_rate_limit, success, transitioned`
- `jobs[0]` 7 keys：`id, last_error, outcome, priority, rows_written, stock_id, trade_date`
- `results[0]` 9 keys：`cid, date, id, ms, note, ok, priority, rows, stock_id`
- 陣列長度：jobs=4、results=4

### Surface 2：current commit `c030c42a` 的 source 逐 branch 鍵集合
`tw-bsr-finmind-sync/index.ts`，cron 走 `mode=worker` → `runWorker()`：

| branch | 位置 | top-level 鍵集合 |
|---|---|---|
| B1 success | L659–678 | 同上 23 keys（逐字比對一致） |
| B2 claim_halt（degrade 不允 claim） | L467–472 | `ok, note, degrade_mode, transitioned, processed, recycled_reservations`（6） |
| B3 rate_limit_exhausted | L477–478 | `ok, note, rate_limit, degrade_mode, transitioned, processed`（6） |
| B4 no_jobs / snapshot_only | L530–536 | `ok, note, rate_limit, degrade_mode, transitioned, processed, snapshot_fulfilled, recycled_reservations`（8） |
| B5 claim_failed | L527 | `ok, error`（2） |
| B6 top-level catch | L1029 | `ok, error`（2，HTTP 500） |
| B7 PostgREST error 包裝 | L898 | `error, code`（HTTP 4xx/5xx） |

巢狀：
- `jobs[]`：由 `recordOutcome()` 固定產生 7 keys → **固定 schema**，與 Surface 1 完全一致。
- `results[]`：`{id, cid, stock_id, date, priority, ms, ...processStock()}`，而 `processStock` 有 5 種回傳形狀（`{ok,rows,note}`／`{ok,rows,note:undefined}` → undefined 鍵被 `JSON.stringify` 丟棄 → 8 keys／`{ok,rows,error}`／`{ok,rows,error,rateLimited}`）→ **variant schema，6–10 keys**，不是固定值。
- `rate_limit_before/after`、`policy`、`snapshot_fulfilled[]` 為固定子物件。

判定：**deploy 前 body（B1）與 current source B1 完全一致，added=0 / removed=0。**

### Surface 3：Stage A 的「old139 / new139」
- 全 repo 搜尋 `139`：只出現在 **plan 散文**（`build-1f-final-plan-v6-2…md` L63「欄位集合仍為 139 keys」）與無關檔案（CSS 行號、Build1b 日期分布）。
- `scripts/`、`supabase/tests/`、fixtures 內**沒有任何腳本或輸出產生過 139**；`bsr_claim_expected.tsv` 也沒有。
- 結論：**139 不是固定 schema**，也不是任何工具輸出，而是當時對某一筆樣本 body 做的**遞迴鍵出現次數（含陣列展開）** 之口述數字，會隨 `jobs`/`results` 長度線性變動（以 id 242197 的 4 jobs 實算為 97）。**139 作為驗收門檻無效，應廢止。**

### SQL test SKIP 的真正意義
`supabase/tests/bsr_metrics_contract_test.sql` 斷言的是 **DB function `bsr_backlog_metrics()` / `bsr_recovery_budget()` 的 JSONB 形狀**，與 Edge HTTP response body **完全無關**。
→ 它 SKIP 不代表 edge response schema 未知；但也代表 **P5 原本引用它作為 response-schema 證據是引用錯物件**（票面缺陷，需更正而非隱瞞）。

## 2. 建議定案

### canonical response contract
廢除單一數字門檻，改為 **per-branch 鍵集合契約**：
- top-level：B1–B7 七組固定鍵集合（如上表）。
- `jobs[]`：固定 7 keys。
- `results[]`：base 6 keys ＋ variant 集合 `{ok, rows} × {note | error(+rateLimited)}`，以「允許集合＋必要集合」表示。
- 驗收語意：**added=0 / removed=0 相對於本契約**，而非相對於某次樣本的鍵計數。

### P5 現況判定
| 項目 | 判定 |
|---|---|
| B1 success branch（唯一有自然 body 的分支） | **PASS**（body 23 keys ≡ source 23 keys；jobs[] 7 ≡ 7；results[] 9 落在允許集合） |
| B2–B7 | **UNPROVEN**（無自然 body，且無 static test 覆蓋） |
| 引用 `bsr_metrics_contract_test.sql` 作為 P5 證據 | **無效引用，撤回** |
| P5 整體 | **維持 UNPROVEN**（依票面「任何 branch 未覆蓋即 UNPROVEN」） |

### 能否不碰 production 關掉 P5？
可以，但需要一支新的 **純 static / deterministic 測試**（純函式化或以 AST／字面比對逐 branch 抽鍵，對照凍結的契約 fixture），完全離線、不呼叫 production。本回合票面禁止新增檔案／改測試，故**本回合不做**，僅提出方案待批准：

- 新增 `supabase/functions/tw-bsr-finmind-sync/response_contract_test.ts`（Deno，離線）＋ fixture `supabase/tests/fixtures/bsr_worker_response_contract.json`
- 內容：對 B1–B7 各 branch 斷言鍵集合；`results[]` 以 variant 允許集合斷言
- 綠燈後 P5：UNPROVEN → **PASS**，全程零 production 互動

## 3. 對 Stage R 的影響（不提前結案）
- 已執行的等價 redeploy 仍成立：source changes = 0、commit `c030c42a`、`index.ts 01b4f5b9…`、`lib.ts 300a1f29…` deploy 前後一致。
- **Stage R remote identity 仍等 Taipei 06:07（UTC 22:07）自然輪次**，此處不變、不提前判定。
- Stage R 最終判定書必須寫入本節更正：P5 原引用錯誤、139 門檻作廢、P5 現為「B1 PASS／其餘 UNPROVEN」。
- Build2 仍 blocked。

## 4. 待你裁決
1. 是否採用 per-branch 契約並正式作廢 139 門檻？
2. 是否批准後續新增上述離線 static contract test 以把 P5 關為 PASS？（本回合不動手）
