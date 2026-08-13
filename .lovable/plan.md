# Stage R — 受控等價 redeploy（remote identity 收斂）Final Execution Ticket

範圍鎖定：本票只執行 v8 §2。**Build2（v8 §4）不批准、不開始**；`exact active-universe` 與 `checkpoint/cursor` 欄位未證明，留待後續獨立票。

Status: ready-for-human（需你在時間窗內批准後執行）

---

## 1. 變更範圍（硬約束）

- **source changes = 0**：不改任何檔案（含 `index.ts` / `lib.ts` / migration / config）。純位元等價 redeploy。
- **只部署** `tw-bsr-finmind-sync`。不部署其他函式、不 migration、不 Publish、不改 cron、不新增 table/view/column/telemetry/腳本。
- **不得 manual invoke** job106 / job107 / worker / Edge / RPC / `net.http_post`；不得人為耗 quota。

---

## 2. 時間窗（Taipei，UTC+8）

| 事項 | 時間 |
| --- | --- |
| 現在 | 05:00（禁止變更窗 :58–:12 內） |
| 禁止變更窗 | 每小時 **:58 – :12**（涵蓋 :02 job106 與 :07 job107） |
| **允許 deploy 窗** | **05:12 – 05:50**（Taipei）＝ UTC 21:12 – 21:50。留 8 分鐘緩衝，不貼 :58 |
| 交易時段檢查 | 今日週五，交易時段 09:00–13:29，deploy 窗不重疊 ✅ |
| Post 讀取輪次 | 自然 **06:07**（Taipei）job107 → **06:07–06:16** 內只讀 `function_edge_logs` |

Deploy 落在 05:12–05:50，與 06:07 相距 > 17 分鐘，故**不採用 deploy 後 9 分鐘讀取**（那段無自然 invoke，log 為 boot-only 或空）；正式 identity 讀取以 **06:07 自然輪次後 9 分鐘內** 為準。若 deploy 當下 tool result 直接回傳 version/deployment_id，優先記錄為鏈的第一段。

---

## 3. 執行前置檢查（全部通過才可 deploy）

1. `cron.job_run_details`：job106、job107 **無 running**（最近一筆 status = succeeded 且 end_time 已存在）
2. `net._http_response`：對應 job107 的最近請求**已完成**（有 status_code），無未完成 request
3. 現在時間確認落在 05:12–05:50 窗內

任一不成立 → 不 deploy，等下一個窗。

---

## 4. Pre-deploy 測試矩陣（任何 FAIL 立即停止，不 deploy）

| # | 檢查 | 指令／來源 | 通過條件 |
| --- | --- | --- | --- |
| P1 | git diff source = 0 | `git status --porcelain supabase/functions/tw-bsr-finmind-sync` | 空輸出 |
| P2 | canonical 凍結 | `scripts/bsr-claim-equivalence.sh`（ephemeral PG17） | 全綠；`bsr_claim_planned.sha256` = `a55fb89e…` |
| P3 | production prosrc hash | 只讀 SELECT `md5(prosrc)` of `public.claim_bsr_queue_jobs` | `c28474cca7be420355edeefd6207104b` |
| P4 | Edge 單元測試 | `lib_test.ts`（`decideQuotaDeferral` / `isQuotaRejection` / `partitionTokenFirst`） | 全綠 |
| P5 | response-schema 契約 | `supabase/tests/bsr_metrics_contract_test.sql` ＋ 既有 139-key body schema 斷言 | 鍵集合完全相符（無新增／缺漏） |
| P6 | focused regressions | `bsr_claim_token_slot_test.sql`（T1–T6）、`bsr_recovery_write_test.sql`、`finmind_admit_v2_test.sql` | 全綠 |
| P7 | negative controls | NC1–NC3（盤中 token 不可 claim／非 token 不佔 token 名額／batch=0 零回傳）＋ partition 三態輸入 | 全綠 |
| P8 | 記錄基線 | repo commit SHA、`index.ts` / `lib.ts` hash | 原文保存於報告 |

---

## 5. Deploy 步驟

1. 於 05:12–05:50 內，呼叫 `supabase--deploy_edge_functions(["tw-bsr-finmind-sync"])`
2. **完整保存 tool result 原文**（含任何 version / deployment_id / source identifier 欄位）
3. 同時記錄當下 repo commit 與 `index.ts` / `lib.ts` hash（應與 P8 相同）

---

## 6. Post-deploy 驗證（只讀）

1. **06:07 自然 job107** 發生後、**06:16 前**，只讀 `function_edge_logs` / `edge_function_logs`（`tw-bsr-finmind-sync`），取得 `version` / `deployment_id`
2. 同一窗內只讀該輪 `net._http_response`：HTTP **200**、body schema 鍵集合與 P5 相同、`jobs`/`job_ids` 存在
3. 行為核對：若該輪有 recovery token，token job 出現在 `jobs[]` 且 `rows_written` 一致；`jobs_quota_deferred` 語意不變
4. 只讀 `cron.job_run_details` 確認 job106/107 status = succeeded
5. 我方 write delta 必須 = 0（除 deploy 本身外無任何寫入）

---

## 7. PASS / FAIL / UNPROVEN 規則

- **PASS**：Pre 全綠 → deploy 成功 → 06:07 後 9 分鐘內取得 `version`／`deployment_id` → 同輪 HTTP200 + schema 相符 + 行為不變 → v6.2 §6 remote identity 記 PASS（鏈：deploy tool result → 自然 log identity → 行為等價；**remote source checksum 仍不可得，如實註記**）
- **UNPROVEN（停止）**：9 分鐘窗內抓不到 version/deployment_id → 記 UNPROVEN，**不得二次 deploy**、不得 manual invoke、不得延長窗
- **FAIL（停止）**：Pre 任一項 FAIL；或 deploy 回錯；或 06:07 輪次 HTTP 非 200 / schema 不符 / 行為異常

## 8. Rollback / Stop conditions

- source 位元等價 → 無程式面 rollback 需求
- deploy 失敗或函式異常：立即以**同一 commit** 重新部署一次以恢復服務（此為復原，非湊證據），並將 identity 記 UNPROVEN
- 停止條件：時間滑出 05:50；job106/107 出現 running 或失敗；`net._http_response` 有未完成請求；出現 quota degrade 轉態；任何需要改 source 的念頭出現

---

## 9. 完成後產出

一份 Stage R 報告：時間戳、Pre 八項結果、deploy tool result 原文、06:07 identity 與 body 證據、PASS/FAIL/UNPROVEN 判定、我方 write delta = 0。
接著才提交 Build1 收斂報告（v8 §1 + §3 證據）。**Build2 仍 blocked，不在本票範圍。**
