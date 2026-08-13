# Build 1f — v7.2 歷史自然證據回收（唯讀報告）+ v7.3 候選

查詢時間 UTC 2026-08-13 20:51（Taipei 08-14 04:51）。全程只 SELECT／讀既有 logs，**我方 production write delta = 0**（無修改、無 deploy、無 manual invoke、無 quota 消耗）。

## 0. 先講關鍵事實：8/13 全日沒有 exhausted

`finmind_quota_ledger` 於 UTC 09:00–18:59（Taipei 17:00–次日 02:59）**全部 granted，`ng = 0`，無任何 `daily_exhausted`**；每輪 `:02` audit 的 `budget_reason` 一律 `cap_1`。
→ A 組三輪（Taipei 8/13 17/18/19）**不是 exhausted class**，是 OPEN class。exhausted 候選本身不成立。

## 1. A 組（Taipei 8/13 17:02→17:07、18、19 ＝ UTC 09/10/11）

| 項目 | 17:07 (UTC 09) | 18:07 (UTC 10) | 19:07 (UTC 11) |
| --- | --- | --- | --- |
| job106 runid / status | 525604 / succeeded（09:02:00→09:02:15） | 525907 / succeeded | 526207 / succeeded |
| job107 runid / status | 525627 / succeeded（09:07:00） | 525930 / succeeded | 526230 / succeeded |
| audit（恰 1 筆） | `cap_1`、`tokens_issued=1`、`tokened_job_ids=[27133]`、`reconciled=[37149]` | `cap_1`、1、`[27169]`、`[37154]` | `cap_1`、1、`[27246]`、`[37118]` |
| ledger | 12 granted / 0 rejected，無 `daily_exhausted` | 11 / 0 | 9 / 0 |
| 自然 HTTP body | **不存在**（`net._http_response` 已被 pg_net 清除，最舊留存為 UTC 15:07） | **不存在** | **不存在** |
| fact 寫入（該小時） | 2420@08-07、6239@08-13、6515@08-13 共 1761 列 | 6573@08-07 等 799 列 | 3432@08-07 22 列 |
| 判定 | **UNPROVEN**（class = OPEN，但缺 body，無法證明 token 被 claim / per-token rows_written） | **UNPROVEN** | **UNPROVEN** |

原因：pg_net response 保留窗約 6 小時；這三輪距回查已逾 9 小時。依 v7.2，logs 遺失 = **UNPROVEN**，不得記 N/A、不得跳過 → 中斷 streak。

## 2. B 組（Taipei 8/14 00:02→00:07、01、02 ＝ UTC 16/17/18）— 三輪 **OPEN PASS**

| 項目 | 00:07 (UTC 16) | 01:07 (UTC 17) | 02:07 (UTC 18) |
| --- | --- | --- | --- |
| job106 runid / 時間 | 527621 succeeded 16:02:00→16:02:12 | 527897 succeeded 17:02:00→17:02:07 | 528174 succeeded 18:02:00→18:02:06 |
| job107 runid / 時間 | 527643 succeeded 16:07:00 | 527919 succeeded 17:07:00 | 528196 succeeded 18:07:00 |
| audit（恰 1 筆） | `cap_1`、`tokens_issued=1`、`tokened_job_ids=[27148]`、`reconciled=[37122]` | `cap_1`、1、`[27208]`、`[37126]` | `cap_1`、1、`[27200]`、`[37131]` |
| ledger | 11 granted / 0 rejected，無 exhausted | 12 / 0 | 12 / 0 |
| 唯一自然 HTTP response | id 241467、200、16:07:00.16 | id 241614、200、17:07:04.03 | id 241759、200、18:07:00.14 |
| processed / claimed | 4 / 4 | 4 / 4 | 4 / 4 |
| `jobs_quota_deferred` | 0 | 0 | 0 |
| total `rows_written` | 311 | 91 | 441 |
| token 被處理 | `27148` outcome=done、rows_written **311** | `27208` done、**91** | `27200` done、**441** |
| fact delta | `4746@2026-08-07` 311 列，ingested_at 16:07:01.86 | `6698@2026-08-07` 91 列，17:07:04.85 | `6409@2026-08-07` 441 列，18:07:02.55 |
| 其餘 job | 37432/42970/43233 皆 `skipped / no_chip_data / rows_written 0`（非寫入） | 同上 | 同上 |
| 判定 | **OPEN PASS** | **OPEN PASS** | **OPEN PASS** |

- **token-first**：body `job_ids` 為 completion order（16:07 為 `[37432,42970,27148,43233]`），**不是 assignment order**，僅能作時序推論，不宣稱直證。
- **FIFO / oldest eligible**：三輪的 token 皆於同輪 `:02` 發出、同輪 `:07` 被 claim；目前 `tw_bsr_sync_queue` 內**已無任何 pending recovery token**（27148/27200/27208/27166 皆 `status=done`）。歷史 pending 快照未保留，故「該 token 即當時最舊 eligible token」為**推論**，非直證。
- **unexpected writes**：同時段 `tw_chip_fact` 另有 `3152@2026-06-30…07-31` 大量列，經查為 `backfill_job_queue`（job105 `backfill-worker`）自然回補 lane（最後更新 20:07），**非本 gate lane、非我方寫入**。除此之外無其他非預期寫入。

## 3. Streak 結算（嚴格 v7.2）

- **open streak = 3/3 PASS**：Taipei 8/14 00:07、01:07、02:07 為時間上連續 eligible cycles，三輪皆 OPEN 且全條件成立。
- **exhausted streak = 0/3**：8/13 全日無 exhausted 狀態，A 組非 exhausted class；且 A 組因 body 遺失記 UNPROVEN。
- 未沿用舊 2/3。

## 4. Exhausted gate 的根因與可達性

近 7 日 8/10–8/12 每日 Taipei 16:00–23:59 皆 `daily_exhausted`，但 8/13 全日 0 rejected：`keepwarm` 當日 `used_today` 遠低於 budget（佇列可 claim 的 job 大幅減少，多為 `no_chip_data` skipped，不耗 quota）。
→ **exhausted 3/3 目前無法自然保證何時再現**，取決於佇列補充量。既有可重用元件：`finmind_quota_ledger`（權威 exhausted 訊號）、`bsr_recovery_budget`（`pool_reserve_blocked`）、`enqueue_chips_prefetch_gaps`（供給端）。不建議為湊 gate 人為耗 quota。

## 5. v6.2 §6 remote identity — 仍 **UNPROVEN / BLOCKING**

- Stage B（對話歷史 #8526，UTC 8/12 22:15）原文即記「**remote version/deployment_id 讀回為 PENDING**」，無 version、無 deployment_id、無 remote source identifier。
- `edge_boot_events`：全表**無任何 `fn` 含 bsr**，`tw-bsr-finmind-sync` 從未上報 boot event。
- Supabase analytics `function_edge_logs` 有 `version` / `deployment_id` 欄位，但**保留窗僅約 9–10 分鐘**；`edge_function_logs` 查 `tw-bsr-finmind-sync` 回 **No logs found**（最近一次自然執行為 UTC 20:07，已超出窗）。
- 無任何唯讀 surface 提供 remote bundle checksum，故 frozen `index.ts 01b4f5b9…` / `lib.ts 300a1f29…` 無法與遠端關聯；DB `md5(prosrc)=c28474cc…` 只證明 DB 函式。
- 22:14 之後是否另有 deploy：對話歷史無紀錄，但**無 deployment history surface 可查**，只能記「無法排除」。

→ 鏈斷在第 1 段（deploy action → remote version）。判定 **UNPROVEN，BLOCKING**。

**最小、零 side effect 的補救（僅提案）**：在任一自然 `:07`（job107）後 **9 分鐘內**純 SELECT `function_edge_logs`（或 `edge_function_logs` 工具）擷取該 fn 的 `version` / `deployment_id`。可建立「自然 log → 目前 remote version」與後續版本連續性，但**仍無法**回溯至 8/12 22:13 的 deploy action，也拿不到 remote source checksum。若你不接受連續性替代證據，此項維持 **BLOCKED**。

## 6. v7.3 候選（等你審核，未執行）

1. **open 3/3 記為 PASS**（B 組三輪，證據如上）。
2. **exhausted 3/3 維持 0/3**：只在自然出現 `daily_exhausted` 的連續三個 eligible `:07` 輪次回收；不人為製造。
3. **每輪必須在 pg_net 6 小時保留窗內回讀**（本次 A 組失敗的唯一根因），時點：`:07` 後 12 分鐘～6 小時內。
4. **remote identity**：唯一零 side effect 路徑為「`:07` 後 9 分鐘內讀 function logs」；能取得即記 version 連續性（仍非完整鏈），否則 BLOCKED。
5. **Build 2 解鎖**：scheduler + remote identity + exhausted 3/3 + open 3/3 全 PASS。目前 **blocked**（缺 exhausted 與 identity）。

**不做**：不修改盤中保護、不手動 trigger／耗 quota、不新增 telemetry/表/欄位/腳本/監控、不 migration/deploy/Publish、不開始 Build 2。
