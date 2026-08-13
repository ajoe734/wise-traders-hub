# Stage R — Final 判定書（Post 只讀完成）

## 1. Remote identity（06:07 自然輪次）
- `function_edge_logs`：`function_id=4e98178a-0d55-4d46-bb82-0b0380a379db`
- `version = 313`
- `deployment_id = yqacmrgdjlenbijclngi_4e98178a-0d55-4d46-bb82-0b0380a379db_313`
- `log id = a4abad22-2240-4e95-ad1f-cdae1cd615b9`、`timestamp = 1786658828289000`（UTC 22:07:08 / Taipei 06:07:08）
- `status_code = 200`、`execution_time_ms = 3279`
- 保留窗內僅此 1 筆該函式 log；**deploy 前的舊 version 已被 retention 清除，無法做 version 遞增對照**（如實註記）。

## 2. Cron / HTTP
- job107 runid `529306`：22:07:00.184 → 22:07:00.200 succeeded
- job106 runid `529284`：22:02:00.153 → 22:02:10.673 succeeded
- 唯一 `net._http_response` id `242344`，created 22:07:04.995，**HTTP 200**

## 3. Body 契約核對（B1 success branch）
- top-level **23 keys**，與 canonical 逐字相同 → **added=0 / removed=0**
- `jobs[]` 唯一鍵集合 = `id,last_error,outcome,priority,rows_written,stock_id,trade_date`（7）
- `results[]` 兩種鍵集合：`cid,date,id,ms,note,ok,priority,rows,stock_id`(9)、`cid,date,id,ms,ok,priority,rows,stock_id`(8) → 皆落在允許 variant（`note` 為 undefined 時被丟棄，符合 source）
- 語意：`processed=4`、`jobs_succeeded=1`、`jobs_quota_deferred=0`、`rows_written=133`、`job_ids=[42970,37432,27101,43233]`
- 本輪 `jobs[].last_error` 為 `no_chip_data`/null，**無 recovery token job** → token-first 行為本輪 **N/A（未觸發，非失敗）**

## 4. Source identity
- 函式檔位元不變：`index.ts 01b4f5b9…`、`lib.ts 300a1f29…`（與 deploy 前相同）
- `git status` 對該函式目錄空輸出；`c030c42a..HEAD` 差異僅 `.lovable/plan.md`（HEAD 現為 `46b9f361`，為平台自動提交計畫檔，非 source 變更）

## 5. P5 誠實結論
- **B1 PASS**：自然 body ≡ source B1 鍵集合
- **B2–B7（claim_halt / rate_limit_exhausted / no_jobs / claim_failed / catch / PostgREST error）UNPROVEN**：無 static test 覆蓋、本輪亦未走到；僅能說 source 相對 deploy 前位元等價，不得宣稱全 branch covered
- `bsr_metrics_contract_test.sql` 屬 DB function 契約，**與 edge response schema 無關**，撤回其作為 P5 證據；「139 keys」門檻作廢（非固定 schema，為樣本遞迴展開計數）

## 6. Stage R 判定
**PASS（附註記）**
- Pre P1–P4/P6–P8 全綠；deploy 為 0 變更等價 redeploy
- Post：自然輪次取得 version/deployment_id、HTTP200、schema added/removed=0、行為語意不變
- 註記：remote source checksum 不可得；舊 version 無法對照；token 分支本輪 N/A
- 我方 write delta = 0（僅 deploy 動作本身）

## 7. Build1 收斂判定
**Build1 = PASS（有註記）**
- Scheduler 自然運行 ✅｜Local freeze 等價與 T1–T6／NC1–NC3 ✅｜Open 3/3 ✅
- Exhausted 分支：Build1f 未觸碰（git 佐證）→ 以安全性論證代自然驗收
- Remote identity：本票收斂 PASS
- 殘留 UNPROVEN：edge response B2–B7 static 覆蓋

**Build2 仍 blocked，未開始。**
