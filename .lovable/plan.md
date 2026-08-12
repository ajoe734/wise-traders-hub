# BSR 背景新鮮度：第一個安全上線的垂直切片

目標：使用者持有的任何台股，不必打開個股抽屜就能被背景保持新鮮；同時給全市場普通股一條公平、永不飢餓的保底輪轉。本切片**只**動 BSR → `tw_chip_fact` / `tw_bsr_daily` 這條鏈。

---

## A. Current production drift（2026-08-12 06:54 UTC vs 8/10 稽核）

| 指標 | 8/10 | 8/12 | 變化 |
|---|---|---|---|
| `expected_latest_bsr_date()` | 2026-08-07 | **2026-08-11** | 前進 2 個交易日 |
| T86 最新日 distinct stock_id（全部） | 19,060 | **19,910** | +850 |
| T86 最新日 4 碼普通股 | 1,991 | **2,016** | +25（宇宙會自然漂移） |
| queue pending / running / failed / done | 2,022 / 2 / 650 / 7,777 | **427 / 0 / 1,728 / 9,157** | pending 大幅消化，但 **failed 翻 2.7 倍**；running 卡死已清空 |
| 最舊 pending `next_run_at` | 逾期 17h | 2026-08-11 07:30（**逾期約 23h**） | 老化惡化 |
| `tw_bsr_daily` 有資料檔數 | 1,612 | **1,671** | +59 |
| `tw_chip_fact` 有資料檔數 | 1,576 | **1,636** | +60 |
| 對最新完整交易日（08-11）覆蓋 | 24.3% | **498 / 2,016 = 24.7%** | 幾乎沒進步 |
| 落後 1–5 日 / >5 日 / 從未有資料 | — | **629 / 326 / 563** | 563 檔（27.9%）從未抓到 |
| quota（今日） | keepwarm 753/960 | keepwarm **480/960**（tokens 80.1）、interactive 0/240、backfill 73/600 | 尚有餘裕 |
| degrade 狀態 | `tier3_paused` | **`normal`**（08-11 10:07 recover） | 已恢復 |
| kill switches | 4 個 enabled | `chips_all` / `chips_keepwarm` / `chips_interactive` / `chips_backfill` 全 enabled | 不變 |

近 3 日 enqueue 歸因：`tier2_gaps:*` 1,330、`chips_prefetch_hourly` 193、`converge_bsr_windows` 12、tier1 8。

**結論**：queue 已消化但覆蓋率原地踏步 —— 因為 job 45 tier2 每天重抓同一批（gap 排序前段），failed 累積，且 563 檔從未進過 queue。這正是「缺公平輪轉」的證據。

---

## B. Decision table

| # | 設計選項 | 決定 | 理由 / 證據 |
|---|---|---|---|
| 1 | 全市場 source of truth | **沿用 `tw_institutional_daily` 最新 `trade_date` 的 distinct `stock_id`**，經 `tw_bsr_eligibility()` 過濾 | 不建 stock_master。T86 最新日 19,910 筆，4 碼普通股 2,016 |
| 2 | ETF/權證/興櫃處理 | 由既有 `tw_bsr_eligibility()` 決定（`^[1-9][0-9]{3}$`、`0xxx` → `unsupported_asset_type`），**誠實降級**：不宣稱涵蓋上櫃/興櫃分類 | T86 無 market 欄；`stock_names` 僅 70 筆不可當分類權威 |
| 3 | `checkup_prefetch_universe()` 定位 | 只當 **lane A 高優先集合**，文件與 log 一律不稱「全市場」 | 其定義只含 trade_records ∪ expert_signals ∪ pf-holdings-v2 ∪ demo registry |
| 4 | Lane A 規模 | 開倉 TW 4 碼 4 檔 + 35 份 `pf-holdings-v2` 使用者組合 → 量級數十至低百檔 | 直接查得；A 每輪必定吃得下 |
| 5 | 是否新建 cursor 表 | **否**，寫入既有 `tw_bsr_sync_config`（`key/config jsonb/version/updated_at/note`）新 key | 表已有 version 欄可做 CAS |
| 6 | Queue 表 | 續用 `tw_bsr_sync_queue`，不搬 `backfill_job_queue` | 已有 `(stock_id, trade_date) WHERE status IN (pending,running,failed,skipped)` 的 unique partial index，天然去重 |
| 7 | 唯一公平輪轉 enqueue owner | **job 106（`enqueue_chips_prefetch_gaps`）擴充為雙 lane**；job 45 tier2、job 53、`converge_bsr_windows` 維持原狀不改 | 最小變更；job 45 只在平日 07:30 跑一次，靠 unique index 互斥即可 |
| 8 | 目標日期 | 只補 `expected_latest_bsr_date()`（今日=2026-08-11）＋ lane A 最多回看 3 個交易日短缺口 | 避免盤中抓今天 → `empty_response` 假綠 |
| 9 | A/B 配額 | 每輪 `p_max_stocks` 預設 300：**A 上限 min(A待補, 120)，B 取剩餘（≥180）**；A 空 → B 全拿；B 空 → A 全拿；quota degrade（`degrade:finmind` ≠ normal）→ 總量降至 60，A 優先 | 依 keepwarm 960/日、實測 ~500 job/日消化量推得：B 每輪 180 × 24 輪遠超日配額，實際受 worker call_budget 節流，故 300 是安全上界 |
| 10 | 防熱門股霸佔 | lane A 以 `(stock_id)` distinct 且「已 fresh 就跳過」，同一檔一輪最多 1 個 job；unique index 保證無重複 active job | — |
| 11 | Stale recovery 權威 | **只認 job 96 `reap_stale_bsr_queue_jobs(60)`**；本切片不動 `recover_stale_bsr_queue_jobs()`（僅在文件標為待淘汰） | 不同時重構兩套 |
| 12 | `materialize_bsr_daily_from_fact` overload 衝突 | **列為 blocker，不修**。若 canary 期間 orchestrator 仍報 ambiguous，僅記錄；本切片產出的 fact 由既有 wave1-3 materialize，覆蓋率驗收改看 `tw_chip_fact` 為主、`tw_bsr_daily` 為輔 | 不順手擴大範圍 |
| 13 | Kill switch | 沿用**程式實際讀取**的既有 key：`chips_keepwarm`（lane B 走 keepwarm pool）與 `chips_all`。新 lane 另受 config key 內 `enabled` 旗標控制 | `_shared/killSwitch.ts` + `finmindAdmission.ts` 的 `POOL_TO_SWITCH` 已讀這些 key |

---

## C. 資料流與狀態機

```text
cron 106 (:02)  enqueue_chips_prefetch_gaps(10, 300)
      │
      ├─ lane A  checkup_prefetch_universe()  ── eligibility ─┐
      │          目標日 = expected_latest_bsr_date()          │
      │          + 最多回看 3 交易日缺口                       │
      │                                                        ├─► INSERT tw_bsr_sync_queue
      └─ lane B  T86(latest trade_date) distinct stock_id      │    ON CONFLICT DO NOTHING
                 從 cursor_stock_id 起，掃描至配額用完 ────────┘    enqueued_by='laneA:*' / 'laneB:cursor'
                 └─ 推進 cursor（掃過就前進，不論 fresh/dedup/unsupported）
                    CAS: UPDATE ... WHERE key=... AND version=$v
      │
cron 107 (:07)  tw-bsr-finmind-sync mode=worker
      └─ claim_bsr_queue_jobs → FinMind → tw_chip_fact
         → materialize（既有 wave1-3 / converge）→ tw_bsr_daily
```

### Cursor config schema（`tw_bsr_sync_config`，key = `laneB_cursor`）

```json
{
  "schema_version": 1,
  "enabled": true,
  "cursor_stock_id": "2330",
  "universe_date": "2026-08-11",
  "wrap_count": 0,
  "last_inspected_count": 300,
  "last_run_at": "2026-08-12T07:02:00Z"
}
```

`version` 欄（既有 integer）作為 CAS token；`updated_at` / `note` 記錄每輪摘要。

### Cursor 狀態機

| 情境 | 行為 |
|---|---|
| 正常一輪 | 取 `stock_id > cursor` 排序前 N 檔 → 掃描 → cursor 設為**最後一檔已掃描代碼**（即使 fresh/dedup/unsupported） |
| enqueue 失敗（例外/RLS/約束） | **不推進 cursor**，整輪 rollback 並回報 `failed>0`；不得無聲跳過 |
| 掃到宇宙尾端 | cursor 重設為 `''`、`wrap_count + 1`，並在 note 記錄一次完整繞行 |
| `universe_date` 與目前 T86 最新日不同 | 不重置 cursor（保持公平位置），只更新 `universe_date`；新上市代碼自然在下一輪繞行被掃到 |
| cursor 代碼已下市（不在宇宙內） | 用 `stock_id > cursor` 的排序語意即可，無需存在性檢查 |
| cursor 不存在 / config 缺失 | 視為 `''` 從頭開始，寫入初始 config |
| 兩個 enqueue 同時執行 | 函式開頭 `pg_try_advisory_xact_lock(hashtext('bsr_laneB_cursor'))`；取不到鎖直接回 `skipped_locked`，且 CAS version 不符即 rollback |

### 每輪可觀測輸出（`enqueue_chips_prefetch_gaps` 回傳 jsonb，並寫 `note`）

`{ lane_a: {candidates, fresh, deduped, inserted, failed}, lane_b: {inspected_from, inspected_to, inspected, eligible, unsupported, fresh, deduped, inserted, failed}, cursor_before, cursor_after, wrap_count, quota_mode }`

### Freshness / 空回語意（worker 端只做定義對齊與回報，不改抓取邏輯）

| 語意 | 判定 | 是否算成功 |
|---|---|---|
| `ok` | fact rows > 0 | ✅ |
| `empty_response` | HTTP 200 但 0 rows，且目標日 = 最後完整交易日 | ❌（計入 failure/backoff） |
| `unsupported` | eligibility 非 eligible | 不入 queue |
| `quota_skipped` | admission 拒絕 | 中性，不計 failure |
| `date_failure` / `partial` / `failed` | 上游錯誤 / rows 少於 `DONE_BROKER_THRESHOLD` | ❌ |

**HTTP 200 + processed>0 一律不算資料成功**，驗收只認 `tw_chip_fact` rows delta。

---

## D. Scoped changed-object / file list

允許修改：

- `supabase/migrations/<new>_bsr_lane_ab_fair_rotation.sql`（additive）
  - `CREATE OR REPLACE FUNCTION public.enqueue_chips_prefetch_gaps(int, int)` — 加入 lane A/B、cursor、advisory lock、結構化回傳（保持既有簽章，cron 106 不需改）
  - `INSERT ... ON CONFLICT DO NOTHING` 寫入 `tw_bsr_sync_config` 的 `laneB_cursor` 初始列
  - `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`（與現有同類函式一致）
- `supabase/tests/bsr_lane_ab_test.sql`（SQL contract test）
- `src/test/unit/bsrLaneQuota.test.ts`（A/B 配額與 degrade 降級的純函式測試，若配額算式抽到 TS 端則必要，否則只留 SQL test）
- `docs/runbooks/chips-lanes.md`（補 lane A/B 與 cursor 章節）

明確禁止（本切片不得觸碰）：

- 任何 OHLCV / institutional / fundamentals pipeline、`bsr_coverage_daily` 泛化、`stock_names` 補表
- `backfill_job_queue` 合流、`tw_bsr_sync_queue` 結構變更
- job 45 / 53 / 107 的 schedule 或 payload、`materialize_bsr_daily_from_fact` overload
- 任何 UI、RLS、subscription、unrelated test
- `DROP` / `DELETE` 任何既有 queue 或資料

安全 review 清單：SECURITY DEFINER + `search_path`、不暴露 `user_id`（lane A 只輸出 stock_id 聚合）、cron secret 不變、`ON CONFLICT DO NOTHING` 原子去重、advisory lock + version CAS。

---

## E. Rollout / rollback / kill switch

**Rollout**：單一 migration 上線 → 不改任何 cron → 等自然 :02 / :07。初期把 config `enabled` 設 true、`p_max_stocks` 沿用 300（若 canary 第一輪 failed>0，改設 config 內 `lane_b_cap: 0` 即等同關閉 lane B）。

**Kill switch**（皆為既有、程式實際讀取）：

- `chips_all` = false → 全鏈停（既有）
- `chips_keepwarm` = false → lane B 的 FinMind admission 直接拒絕
- `laneB_cursor.enabled` = false（config 一行 UPDATE）→ enqueue 只跑 lane A

**Rollback**：`CREATE OR REPLACE` 舊版函式定義（migration 內附註舊 body 全文），**不刪 queue、不刪 fact、不刪 cursor config**；cursor 列保留供 audit（`version` 遞增即歷史軌跡）。

---

## F. 驗收 / 證據格式

門檻檢查：focused vitest（新增檔）＋ `supabase/tests` SQL contract ＋ `tsgo` typecheck ＋ `npm run check:module-boundaries`。**不為 unrelated full-suite failures 改碼**。

Canary：先取 baseline 快照，再等**至少 3 輪自然 :02 enqueue / :07 worker**，禁止手動呼叫。

每輪必須提供：

```text
cron runid → pg_net request_id → HTTP status/body
→ enqueue 回傳 jsonb（lane_a/lane_b 明細、cursor_before/after、wrap_count）
→ 新增 queue IDs（含 enqueued_by）
→ worker run_id / processed / logical_calls / calls_spent
→ tw_chip_fact rows delta（分 stock_id）
→ 覆蓋率 delta（分母 = T86 最新日 4 碼普通股）
```

抽查樣本：使用者持股 ≥3 檔、非持股市場前段/中段/後段各 ≥3 檔、unsupported（0050 / 00878 之類）≥2 檔。

**PASS 條件（需全部成立）**：cursor 單調前進或正確 wrap；lane A 目標日缺口在 1 輪內入列；lane B 三輪 inspected 區間不重疊且非永遠前段；無 lazy enqueue（抽屜開啟不產生 job）；同 stock/date 無重複 active job；`empty_response` 不被計為成功；queue 最舊 pending 老化未惡化。

**PARTIAL**：任一輪被 quota 擋住 → 誠實回報 PARTIAL 並等下一輪。三輪不足、只看 HTTP 200、或 Preview 未驗證 → 不得判 Done。不 Publish。

---

## G. 我對這份需求的挑戰（請一併裁決）

1. **「全市場」在本切片仍是代理宇宙**。T86 沒有 market 欄，無法證明上櫃/興櫃完整；我會在 log 與文件一律寫「T86 proxy universe」而非全市場。要更嚴謹只能未來另建 listing master —— 本輪不做。
2. **覆蓋率不會因這個切片快速上升**。以目前每日約 500 job 的實際消化量、2,016 檔宇宙，光是把「單一最新交易日」補齊就要約 4 天，一次完整 wrap ≈ 4 天。這個切片保證的是**公平與不飢餓**，不是短期覆蓋率跳升。
3. **failed 1,728 筆是既有債**。它們佔用 unique index 的 active 名額，會讓 lane B 對這些檔「看似 deduped」而永遠不重試。本切片**不清理**，但這是 PASS 後的第一順位後續（需要另一輪決策：是否讓 failed 超過 N 天自動回 pending）。
4. **job 45 tier2 仍會每天丟 1,300+ 筆**與 lane B 語意重疊。本切片靠 unique index 互斥不衝突，但長期應停用 tier2 讓 lane B 單獨當家 —— 列為待淘汰，本輪不刪。

其餘無待決問題；若你同意上述四點的處理方式，即可批准進 Build。
