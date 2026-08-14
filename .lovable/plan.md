# Build2 Recovery Plan P5 — Decision Memo（唯讀調查，尚未實作）

## 1. 已證實事實（含證據）

| # | 事實 | 證據 |
|---|---|---|
| F1 | `TaiwanStockTradingDailyReport` **必須帶 data_id**；省略即固定 HTTP 400 | N1 `net._http_response#243732` body：`finmind_http_400:{"msg":"parameter data_id can't be none on TaiwanStockTradingDailyReport dataset","status":400}` |
| F2 | 原始誤判來源在程式註解本身，非官方契約 | `supabase/functions/_shared/finmindMarketBatch.ts` L1–L13 假設「若 sponsor plan 支援，省略 data_id 可一次抓整市場」；`fetchFinmindMarketDay()` L74–L80 只送 `dataset+start_date` |
| F3 | 這個 400 被錯分類成 transient | 同檔 `isCapabilityFailure()` 只認 `finmind_api_*` 且含 permission/level/upgrade 等字樣；`finmind_http_400` 走到 catch 尾端 → `markInconclusive()`。因此 job67 每日重打、永遠 inconclusive、且不會寫 `supported=false` |
| F4 | per-stock 路徑是唯一實際可用契約 | `tw-bsr-finmind-sync/index.ts` `fetchFinmindOneDay()` 帶 `data_id`，今日成功 |
| F5 | 使用者持股「不開抽屜也會入隊」的鏈路已存在 | `checkup_prefetch_universe()`（trade_records + published expert_signals + `checkup_storage.key='pf-holdings-v2'` 的 `code/symbol` + `chips_prefetch_targets`）→ `detect_chip_gap_jobs()` → `enqueue_chips_prefetch_gaps()`（每小時 cron）→ `tw_bsr_sync_queue` → hourly worker |
| F6 | 6515 / 8028 不是漏抓，是延遲 | queue 兩檔 08-14 皆 `status=done`（09:50–09:51 UTC，attempts=5），`enqueued_by=tier1_first_fetch`。N1 快照時間點在其完成前 |
| F7 | 目前唯一 pending：5271，`last_error=finmind_empty`，attempts 4/5 | `tw_bsr_sync_queue` 讀取 |
| F8 | 真實成本遠高於 1 request/stock | 今日 `finmind_quota_ledger`：interactive 265 grants / 65 distinct stocks（**4.08 req/stock**）、keepwarm 29/14（2.07）、backfill 80 grants/11 stocks（多日回補） |
| F9 | quota 天花板 | pools：interactive 240、backfill 600、keepwarm 960（daily_budget 合計 **1800/日**，refill 1/min，capacity 240）。interactive 今日 `used_today=240` 已滿 |

## 2. 未證實假設（不得當事實用）

- FinMind 是否有**任何** dataset 可一次取全市場分點（例如更高方案或 `TaiwanStockTradingDailyReportSecIdAgg`）——repo 內無憑證、未打過，狀態 UNPROVEN。
- 提高方案額度後 `data_id` 契約是否改變——無證據，預設不變。
- `enqueue_bsr_backfill` 內 `app_role='admin'` 缺陷：call graph 已證實**不在**本路徑（hourly worker / prefetch gaps 皆未呼叫），維持 out-of-scope。

## 3. 現有能力盤點（不需新表）

```text
checkup_storage(pf-holdings-v2) ┐
trade_records                   ├→ checkup_prefetch_universe() → detect_chip_gap_jobs()
expert_signals(published)       │        (tw_bsr_eligibility 過濾)
chips_prefetch_targets          ┘                 ↓
                                   enqueue_chips_prefetch_gaps(hourly cron)
                                                  ↓
                             tw_bsr_sync_queue ── claim_bsr_queue_jobs ──→ tw-bsr-worker-hourly
                                                  ↓
                    tw_bsr_daily → tw_chip_fact → tw_chips_rollup → bsr_coverage_daily
```

已存在且可沿用：stale-first queue、priority 1/2/3、quota pools 三桶＋borrow、recover_stale/quota_failed、backpressure budget、snapshot fulfil、coverage refresh。**無需新表、無需平行控制面。**

發現的兩個既有排序缺陷（本 memo 的核心修正點）：

- **D1 公平性**：`detect_chip_gap_jobs` 以 `ORDER BY gap_count DESC LIMIT _max_jobs` 選股。缺口最大的（從未抓過的冷門股）永遠排在前面，只缺 1 天的使用者持股被擠到最後——與 SLO 相反。
- **D2 優先級扁平**：`enqueue_chips_prefetch_gaps` 只用「日期是否為最新交易日」決定 priority(1/2)，**不分是否為使用者持股**。Lane A 與全市場輪轉共用 tier1 interactive 桶，於是 interactive 240 被輪轉股吃光（今日已 exhausted）。

## 4. 容量表（用今日 production 實測成本計算）

| 路徑 | 每股實際成本 | 日可處理股數 | 全 universe(≈1,553) 完整週期 | Lane A 飢餓風險 |
|---|---|---|---|---|
| A. 持股優先＋觀察集低速輪轉 | Lane A 4.1 req（interactive）、輪轉 2.1 req（keepwarm/backfill） | Lane A ≈150 檔用 ~615 req；剩餘 1,185 req ÷2.1 ≈ **560 檔/日** | **≈2.8 天** | 低（Lane A 有保留桶） |
| B. 全市場一律輪轉（現況） | 混合 ~3.5 req | 1800÷3.5 ≈ **510 檔/日** | ≈3.1 天 | **高**（已實際發生：interactive exhausted、5271 pending） |
| C. 真正 bulk upstream | — | — | — | **不存在**：F1 證明 FinMind BSR 無 bulk；repo 內無其他已授權 bulk 分點來源（TWSE 只有指數/法人，無 broker branch） |

結論：**B 在現有 quota 下不可能每日完成全市場**（最快 3 天一輪）。「每小時慢慢抓就會保持全市場最新」是錯的，必須明說。可達成的 SLO 只有：**任何使用者已保存持股 T 日資料當日新鮮；未被持有的股票 3–4 天輪一次。**

另外 `finmind_empty`（盤後尚未結算）目前吃滿 5 次重試 × 每次 1 quota，是 4.08 req/stock 的主因；只要把 empty 的重試改為「等下一個 slot、最多 2 次」即可把 Lane A 成本壓到 ~2 req/stock，等於多出 ~300 檔/日輪轉量。

## 5. 建議方案（最小、可回滾、全部沿用既有物件）

**M1 — job67 分類修正（停止每日浪費）**
`isCapabilityFailure()` 增加一條：`finmind_http_400` 且 msg 含 `data_id can't be none` → 判 `unsupported`（寫 `supported=false` + `probed_at`），Phase A 從此不再嘗試。job67 改為 **每月一次**（`21 7 1 * *`）保留契約回探能力，理由：方案升級或 API 改版時仍能自動察覺。

**M2 — Lane A 與輪轉分桶（解 D2）**
`enqueue_chips_prefetch_gaps` 入隊時，若 symbol 的 sources 含 `trade_records/checkup_storage/expert_signals` → priority 1；只來自 `registry`/純觀察集 → priority 3（走 keepwarm/backfill 桶）。tier→pool 映射已存在（`poolFromTier`），不需改 worker。

**M3 — 公平選股（解 D1）**
`detect_chip_gap_jobs` 排序改為 `ORDER BY is_user_held DESC, (最新交易日缺口) DESC, last_attempt NULLS FIRST, gap_count DESC`，仍受 `_max_jobs` 限制。

**M4 — empty 重試語意**
`finmind_empty` 不計入 attempts 上限，改為 `next_run_at = 下一個小時`，最多 2 次/日，避免結算前空轉燒 quota。

回滾：M1/M4 為 Edge source 單檔改動；M2/M3 為 `CREATE OR REPLACE FUNCTION` 兩支，回滾即 replace 回現行 prosrc（已存 hash）。無 schema、無新表、無 UI。

### 精確 diff 邊界

- 可改：`supabase/functions/_shared/finmindMarketBatch.ts`（M1）、`supabase/functions/tw-bsr-finmind-sync/index.ts`（M4 retry 分支）、migration：`detect_chip_gap_jobs`、`enqueue_chips_prefetch_gaps`、`cron.alter_job(67, schedule)`。
- 保持 frozen：`claim_bsr_queue_jobs`（Build1f 位元凍結）、`finmind_admit_v2`、所有 quota pool 參數、`enqueue_bsr_backfill`/`app_role`（out-of-scope）、所有 UI、其他 cron。

## 6. 測試門檻（先離線／ephemeral）

1. `finmindMarketBatch_test.ts`：400 `data_id can't be none` → outcome `unsupported` 且寫入 supported=false；429/5xx/空 rows 仍 `inconclusive`。
2. ephemeral SQL：`detect_chip_gap_jobs` 在「持股缺 1 日 + 冷門股缺 60 日」情境下，持股必須進前段；`enqueue_chips_prefetch_gaps` 對持股寫 priority 1、對 registry-only 寫 priority 3；重跑冪等。
3. quota 失敗分支：pool exhausted → job 記 `deferred/skipped` 而非 failed；stale running 由 `recover_stale_bsr_queue_jobs` 回收；日期部分失敗 → coverage 記 partial。**green worker 不算完成**。

## 7. 自然驗收門檻（不得 manual invoke）

證據鏈一律 `cron runid → cron_edge_call request_id → net._http_response → queue job → tw_bsr_daily/coverage`。

- 隔日 Taipei 15:30 / 16:07 / 17:07 自然輪次後：Lane A（所有使用者持股 ∩ eligible）**當日缺漏 = 0**、interactive pool 未 `daily_exhausted`、輪轉股當日新增 ≥ 300 檔。
- job67 下月自然輪次前不得再出現 probe 呼叫（`net._http_response` 無新 market-batch 400）。
- Preview acceptance：dedicated E2E 帳號仍為 `checkup_storage` 0 rows，**per-holding Preview 標 BLOCKED**，只做「登入 /holding-checkup → 0 enqueue」與 server-side 全市場覆蓋兩段，不冒充 PASS。

停在此處等待審核，不執行。
