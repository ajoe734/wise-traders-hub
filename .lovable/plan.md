# G1 Final Gap Audit Report（唯讀）

全程唯讀。未修改 source/test/fixture/migration/DB/cron/config，未 commit/deploy/manual invoke/補跑/Publish/Preview/開抽屜。

## A. Wrong-task working-tree audit

```text
git status --short        → (空)
git diff --name-status    → (空)
git diff --stat           → (空)
git diff --cached         → (空)
untracked (exclude-standard) → (空)
git status                → On branch edit/edt-38c7e2cd-…  nothing to commit, working tree clean
```

**目前工作區完全乾淨；沒有任何未提交的 test-only diff 殘留。**

HEAD = `804631c57`（2026-08-14 13:57 UTC / 21:57 Taipei，"Update tests and migrations"）。相對 `5bc4d8486` 的完整檔案清單，即 **P6-R1 已核准成果**：

| 狀態 | 檔案 | 增/刪 |
|---|---|---|
| M | `supabase/functions/_shared/finmindMarketBatch.ts` | +77 |
| M | `supabase/functions/_shared/finmindMarketBatch_test.ts` | +61 |
| A | `supabase/migrations/20260814134905_f5d98ef1-….sql` | +149 |
| A | `supabase/tests/chips_lane_a_fairness_test.sql` | +172 |
| M | `supabase/tests/fixtures/bsr_e2e_functions.sql` | +60/-23 |
| M | `supabase/tests/fixtures/bsr_e2e_schema.sql` | +4 |
| A | `.scratch/p6r1/{cfg,cron_all,job67}_before.txt` | pre-migration 只讀存證 |
| R100 | `.lovable/plan.md` → `.lovable/plan/p6-r1-…-2026-08-14.md` | 核准後歸檔 |

檔案 mtime 全部落在 **13:46–13:55 UTC**（P6-R1 實作 turn 內），最新一筆為 `chips_lane_a_fairness_test.sql` 13:55。誤跑 Build2 R2 的 turn 發生在 13:57 之後，**該區間內沒有任何檔案被寫入**。

fixture 兩檔的 diff 內容（`detect_chip_gap_jobs` 加 `source_rank` / `open_tr`、`enqueue_chips_prefetch_gaps` 用 `v_rank` 與 `chips_prefetch_hourly:r<n>`、queue 去重）與 migration `20260814134905` 的函式定義同源，屬 **P6-R1 核准範圍內的 fixture 同步**，不是誤跑產物。

**結論：不存在「剛才誤跑造成的未授權 diff」。** 亦即 §H 沒有需要裁示的檔案（詳見 H）。

Production write 檢查（cutoff 13:50 UTC，涵蓋誤跑整段）：

| 指標 | 值 |
|---|---|
| `tw_bsr_sync_queue` 新增（enqueued_at > 13:50） | **0** |
| `tw_bsr_daily` 新增（created_at > 13:50） | **0** |
| `function_run_logs` | 9（皆為自然 cron 觸發） |
| `cron.job_run_details` | 152（自然排程） |
| job 67 command | `SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{"mode":"probe","force":true}'::jsonb, 120000);` — 與 R4 read-back 逐字相同 |
| job 67 schedule | `30 13 * * 1` — 未變 |
| 最後三筆 migration | `20260814134905, 20260814101507, 20260813233617` — 無新增 |
| job 106 / 107 | 14:02 / 14:07 `succeeded`（自然） |

**無任何 production write 或 production/source diff 由誤跑造成 → 不觸發 STOP。**

## B. Population truth（更正先前敘述）

`checkup_storage where key='pf-holdings-v2'`（不輸出任何 user_id）：

| 指標 | 值 |
|---|---|
| storage rows | 36 |
| distinct storage users | 36 |
| `jsonb_typeof(data)='array'` | 36 / 36 |
| **非空 holdings user count** | **5** |
| 空陣列 rows | 31 |
| 每列筆數分布 | `0×31, 1×2, 2×1, 13×1, 28×1` |
| holding items 總數 | 45 |
| distinct codes | 42 |
| eligible（`^[0-9]{4}$`） | 29 |
| ineligible | 13 |

先前把「36 storage users」寫成「36 位有持股使用者」是錯的；正確為 **5 位非空持股使用者**，36 為 storage rows/users 總數。

## C. 29 eligible readiness + coverage 完整分布

`expected_trade_date` = `max(tw_bsr_daily.trade_date)` = **2026-08-14**。29 檔逐一計算，輸出 aggregate 與非 ok 代號。

| 指標 | 結果 |
|---|---|
| `tw_chip_fact` latest = 2026-08-14 | 29 / 29 |
| `tw_bsr_daily` latest = 2026-08-14 | 29 / 29 |
| `bsr_coverage_daily` 最新 date = 2026-08-14 | 29 / 29 |
| freshness（daily 與 fact 皆 = expected） | **29 FRESH / 0 STALE / 0 MISSING** |
| `daily_price_snapshots` 2026-08-14 有該 symbol | 28 / 29 |
| BSR series ready5（have5 ≥ 5） | 29 / 29 |
| ready20 / ready60 | 3 / 29、2 / 29 |

29 檔 coverage state 完整分布（非抽樣）：`ok = 28`、`missing_snapshot = 1`（**5271**）、`broker_under_cover = 0`、`broker_over_cover = 0`、其他 = 0。

全市場 2026-08-14 完整分布：`ok 40 / broker_under_cover 20 / broker_over_cover 4 / missing_snapshot 1`（合計 65 = `tw_bsr_daily_snapshot_status(2026-08-14).coverage_stocks`）。全歷史：`ok 3494 / broker_under_cover 233 / broker_over_cover 132 / missing_snapshot 3742`。

## D. 5271 root

- `bsr_coverage_daily.coverage_pct = broker_sum_shares / daily_price_snapshots.volume_shares`。5271 的 `snapshot_volume_shares` 為 **NULL** → 落入 `missing_snapshot`。
- **缺的那張 row**：`daily_price_snapshots (symbol='5271')` 全歷史 **0 列**（不只 8/14）。2026-08-14 該表 141 檔中，29 檔 eligible 有 28 檔在內，唯一缺席者就是 5271。
- BSR 端正常：`tw_bsr_daily 5271` 有 924 列 / 10 個交易日（2026-08-03 ~ 2026-08-14），8/14 broker_count 133、broker_sum_shares 456,565；`tw_chip_fact` 亦有 924 列。近 5 個交易日 coverage 全為 `missing_snapshot`。
- **產生的自然 stage**：收盤價量快照供給端（`daily-snapshot` / `backfill-daily-snapshots` 寫入 `daily_price_snapshots`），與 BSR lane A/B 無關。
- **性質判定：全市場 snapshot partial 的品質標記，不是 drawer readiness 的必要條件。** `tw-chips-detail` 的 readiness 只讀 `tw_chips_rollup`（`get_bsr_daily_series`：`window_days=5 AND bsr_available`）與 `tw_institutional_daily`；`snapshot_state` 只讀 `tw_bsr_daily_snapshot_status`（該日 partial、無 sealed_at）。**整條 readiness 路徑不讀 `bsr_coverage_daily`。**

## E. 前端真實 call graph

```text
/holding-checkup (FreeCheckup)
└─ HoldingsWorkbench.tsx:105
   └─ useChipsBatch({ codes: sparklineCodes, enabled: !isDemo })
      └─ chipsRepository.fetchChipsBatch / prefetchChipsPayload
         └─ POST /functions/v1/tw-chips-detail        ← page load 唯一網路呼叫（唯讀）

row click → openHoldingDrawer (HoldingsWorkbench:240-249, Sheet:316)
└─ ChipsSection.tsx
   ├─ chipsRepository.fetchChipsPayload → /tw-chips-detail?stock_id=…
   ├─ useChipsLifecycle:84   useChipsBackfill(stockCode)
   └─ useChipsLifecycle:102  useChipsAutoBackfill({hasData, sparse, eligible, syncStatus, satisfied})
      └─ chipsBackfillMachine.shouldAutoTrigger → requestBackfill
         └─ Promise.allSettled:
            ├─ functions.invoke('tw-institutional-daily-sync', {mode:'backfill_stock', days:60})
            └─ rpc('enqueue_bsr_backfill', {p_stock_id, p_days:60})
```

判定條件：

- `deriveChipsFacts`（chipsLifecycle.ts:84-98）：`instDays = series.institutional_daily.length`、`bsrDays = series.bsr_concentration.length`，**`sparse = instDays < 20 || bsrDays < 5`**。
- `isBackfillSatisfied`：`institutional readiness 60/20 === 'ready'` 或 `instDays >= 20`。
- `shouldAutoTrigger`：`hasData && sparse`，且 `eligible !== false`、`syncStatus ∉ {pending, running}`、該股本 session 未 fired。
- `useChipsBackfill`：module-level in-flight 去重 + 每檔每 session 上限 2 次。
- `ensure_bsr_queued`：**production 無任何呼叫端**（僅存在於 `supabase/tests/*` 與舊 migration；`ChipsSection.tsx:192` 註明 P3 起前台開抽屜不再呼叫）。
- `tw-chips-detail`：內部只跑 `rebuild_bsr_rollup` / `get_bsr_daily_series` / `tw_bsr_eligibility` 等查詢，**不 enqueue**。
- `tw-bsr-finmind-sync`：前端**沒有**任何直接呼叫路徑，只由 cron（45/46/51/53/67/106/107）觸發。

**明確回答**

1. **daily/fact fresh 但 coverage=missing_snapshot、未開抽屜**：只打 `tw-chips-detail`，**不會 enqueue**。`bsr_coverage_daily` 不在任何前端判定式中。
2. **開抽屜**：是否 enqueue 與 coverage **無關**；取決於 `sparse = instDays<20 || bsrDays<5`。若 sparse 為真且未 satisfied，會呼叫 Edge `tw-institutional-daily-sync`（mode `backfill_stock`）與 RPC `enqueue_bsr_backfill`。
3. **pre-existing 風險（只列不修）**：`public.enqueue_bsr_backfill` 第 19 行 `SELECT public.has_role(v_uid,'admin')`，而 `public.app_role` 僅有 `company_admin, analyst` → 一般會員呼叫必拋 enum 例外，RPC 永遠 0 enqueue，且被 `Promise.allSettled` 吞掉，UI 仍顯示成功。

## F. Drawer hypothetical（依現況 production state 計算，未開抽屜）

`tw_bsr_sync_queue` 對這 29 檔最新狀態皆為 `done`（無 pending/running 抑制）。

| 判定 | 檔數 | 代號 |
|---|---|---|
| ready（不觸發） | **24** | 1314,1513,1711,1717,2303,2308,2313,2330,2344,2543,3017,3042,3189,3231,3443,3481,3491,3617,3702,4583,4958,6239,6770,6862 |
| **stale（會觸發 enqueue/backfill）** | **5** | **3529, 4979, 5271, 6180, 8086** |
| missing | 0 | — |

5 檔共同特徵：`inst_days = 14 (<20)`、`bsr_days 7~10`；BSR/fact 皆已 8/14 最新，卡點在 `tw_institutional_daily` 只有 2026-07-28 起 14 天。且這 5 檔**不在** `institutional_new_stock_queue`（該表 36 列：34 done、2 running 為 3363/3152，卡在 `sealed and cannot be modified`），`cold_start_status.state=done`（2026-08-03 結束）→ **目前沒有任何伺服器排程會把這 5 檔法人歷史補到 ≥20 天。**

## G. 原始「要開抽屜才回補」server path 判定

**PARTIAL。**

- BSR 面向 **PASS**：29/29 在無人開抽屜下 `tw_bsr_daily` / `tw_chip_fact` 皆 2026-08-14 最新、ready5 29/29；`missing_snapshot`（僅 5271）經 §D/§E 證明為**非阻斷品質標記**。
- 但 29 檔中仍有 **5 檔**一開抽屜就會觸發 lazy 回補握手 → 不能判 PASS。
- 最小根因（**不實作**）：
  - R-A：`sparse` 由 `tw_institutional_daily` 天數決定，但伺服器側 Lane A 公平化只覆蓋 BSR，法人序列沒有等價的 saved-holdings 補歷史排程；cold_start 已 done、`institutional_new_stock_queue` 未含這 5 檔。
  - R-B：`enqueue_bsr_backfill` 的 `has_role(..,'admin')` 與 `app_role` enum 不符，lazy BSR 分支恆例外且被 UI 靜默吞掉（pre-existing）。
- Plan 候選（僅列）：P-1 對 saved holdings 做法人 60 日 gap 偵測並交由既有 `tw-institutional-daily-sync` 排程補齊；P-2 修正 `enqueue_bsr_backfill` 角色判定並讓 UI 不再吞錯；P-3 補 5271 進 `daily_price_snapshots` 供給以消除 `missing_snapshot`。
- **routing branch 仍 N/A — not observed**（22:02 job106 inserted 0），未以 offline/ephemeral 冒充自然觸發。
- **`bsr_metrics_contract_test.sql` 根因仍 UNPROVEN**：僅證明「與 pre-P6 還原後錯誤字串完全相同 → 非本次 regression」，不得稱為已知 fixture 缺 seed。

## H. 未授權變更處置候選

**目前無未授權變更可處置。** 工作區乾淨、無 stash、無 untracked、無 staged；HEAD 內全部檔案 mtime ≤ 13:55 UTC 且全數落在 P6-R1 核准範圍。誤跑 Build2 R2 期間（13:57 之後）**沒有任何檔案寫入、沒有任何 production write**。

因此本節無「保留／回復」清單需要你裁示。若你認為 P6-R1 提交內某些檔案（例如 `supabase/tests/fixtures/bsr_e2e_functions.sql`、`bsr_e2e_schema.sql`、`.scratch/p6r1/*`）本不該進 commit，請明確指名，我再另外提案；本輪不動作。

停在此處等你審核。
