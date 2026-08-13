# Build2 Final Plan P1 — 全市場 BSR 覆蓋（Stage P，唯讀查證版）

狀態：**部分 BLOCKED**（§1 缺 security master、§5 顯示 per-stock 輪轉在數學上不可能達成每日全市場）。以下每一項都附 production 實測，未使用抽象詞。

---

## 1. Exact active eligible ordinary-stock universe → **BLOCKED（資料缺）**

實測（`psql \d` + count）：
- `public.stock_names`：欄位僅 `symbol, name, created_at, currency, market, asset_class`。**無上市狀態、無證券類型、無交易所別（market 僅 NULL/US）**。
- 筆數：**72 列**；`asset_class='tw_stock'` 72 列；其中符合 `^[1-9][0-9]{3}$` 僅 **36 列**。
- `tw_bsr_eligibility(p_stock_id)` 逐字語意：純字串規則，**不查任何上市清單**
  - `^[1-9][0-9]{3}$` 才 eligible → 排除 ETF/受益憑證（`0xxx`）、ETN／權證（5–6 碼）、非四碼
  - 在 `stock_names` 且 `asset_class <> 'tw_stock'` → `unsupported_asset_type`
  - **無法排除興櫃／已下市／全額交割**（DB 內無此欄位）

結論：**DB 內不存在 exact active universe**。可用的最接近實測母體：
- `tw_bsr_daily` 近 60 日 distinct stock_id = **1692**，其中四碼普通股 = **1551**
- `tw_chip_fact` 近 60 日 distinct stock_id = **1658**

→ 兩條路（Stage P 需你選）：
- **P1-a（不新增資料）**：以「近 60 日曾出現於 `tw_chip_fact`／`tw_bsr_daily` 的四碼代號」＝ observed active universe（1551），語意為「上游近期有分點資料者」。可證明 eventual coverage，但**不等於官方上市清單**，興櫃/下市只能靠「上游連續無資料」自然淘汰。
- **P1-b（新增資料）**：引入 FinMind `TaiwanStockInfo` 週更市場主檔（新表或擴充 `stock_names`）→ 才可能做到 exact。**這需要新物件，違反 §6 最小面**。

**禁止用 `checkup_prefetch_universe()` 當市場**：實測它由 `trade_records ∪ expert_signals ∪ checkup_storage ∪ chips_prefetch_targets` 組成（持倉導出），現行覆蓋僅約 **59–63 檔／日**（08-13 coverage=63、08-12=63）。這正是目前全市場只有 3–5% 覆蓋的根因。

## 2. chips_prefetch_targets 與新鮮度欄位

`chips_prefetch_targets`：`code(PK), source(chk: demo_seed|manual|ops), active, supported, reason, created_at, updated_at`；index 只有 PK；trigger `chips_prefetch_targets_touch`；RLS：admin 讀、service_role 全權。
**無 cursor、無 checkpoint、無 last_attempted_at、無 rank —— 明確沒有。** 寫入者：ops/manual（無自動寫入者）；讀取者：`checkup_prefetch_universe()`。

可用新鮮度來源（實測）：
- `bsr_coverage_daily(stock_id, trade_date)` PK＋`idx_bsr_coverage_daily_date(trade_date DESC)`、`idx_..._class`
- `tw_bsr_daily`（1692 檔）、`tw_chip_fact`（1658 檔）
- `tw_bsr_daily_snapshot_status(trade_date PK)`：`status/lane_a_status/lane_b_status/lane_c_status/coverage_stocks/coverage_rows/sealed_at`
- `expected_latest_bsr_date()` → 實測回 **2026-08-13**
- `tw_bsr_sync_queue`：`tw_bsr_sync_queue_active_uniq(stock_id,trade_date) WHERE status IN (pending,running,failed,skipped)`、`ready_idx(priority,next_run_at) WHERE pending`、`ready_pc_idx` 同上且 `post_close_only=false`

→ **stale-first 排序所需欄位全部已存在，不需新欄位。**

## 3. 既有元件真正語意（逐字讀 prosrc）

| 元件 | 語意 | side effect | 上限 |
|---|---|---|---|
| `enqueue_chips_prefetch_gaps(p_lookback_days, p_max_stocks)` | 用 `detect_chip_gap_jobs` 找缺口 → 對每個 (stock,date) 若 `tw_bsr_daily` 無列則 INSERT queue（priority: 當日=1 其餘=2，`post_close_only=false`）；接著呼叫 `recover_stale_bsr_queue_jobs()`、`bsr_recovery_budget(12)`、`recover_quota_failed_bsr_jobs(budget)` | 寫 queue、寫 recovery token | `p_max_stocks`（job106 傳 300）× lookback 交易日 |
| `detect_chip_gap_jobs` | **母體＝`checkup_prefetch_universe()` WHERE supported**，非市場 | 純 SELECT | `LIMIT _max_jobs`，`ORDER BY gap_count DESC` |
| `enqueue_all_active_tw_holdings_bsr(p_lookback_days)` | 同樣以 `checkup_prefetch_universe()` 為母體，逐股回填 N 個工作日 | 寫 queue | 無 stock 上限，`EXIT WHEN v_d < today-30` |
| `ensure_bsr_queued` / `ensure_bsr_window` | 單股 on-demand 入列（抽屜用） | 寫 queue | 單股 |
| job106 `2 * * * *` | `SELECT public.enqueue_chips_prefetch_gaps(10, 300);` | — | — |
| job107 `7 * * * *` | worker `{"mode":"worker","batch":30,"budget_ms":45000,"max_priority":3,"ignore_window":true}` | — | batch 30 |
| job46 `*/10 6-12 * * 1-5`、job98 `*/10 * * * 6,0` | 同 worker，job46 無 ignore_window | — | batch 30 |
| quota admission | `finmind_admit_v2(pool,kind,stock_id,cost,allow_borrow)`；pools 見 §5 | 扣 token/日額 | 見 §5 |

## 4. 方案選擇 → **選 B（無狀態 stale-first），但需修正母體**

B 可行的證據：排序所需的 `latest coverage / expected date / queue 去重` 全部已存在索引；`active_uniq` 天然做 dedupe；不需 cursor。A（持久 cursor）需新欄位，被 §6 排除。
**採 B**：`observed universe LEFT JOIN latest coverage`，`ORDER BY (missing latest expected date) DESC, oldest_covered_date ASC, stock_id`，`WHERE NOT EXISTS (active queue row)`，每輪 `LIMIT N`。

## 5. 真實容量（全部為實測，不是估計拍板）

- 母體：1551（四碼、近 60 日 observed）
- 最新 expected date `2026-08-13` 覆蓋：**63 檔**（`bsr_coverage_daily`），08-12 = 63、08-11 = 844、08-10 = 603
- queue 現況：pending **0**、running 3、**failed 1661**、近 24h done **138**
- failed 原因：`daily_exhausted:pool=keepwarm` 1359、`rate_limited:pool=keepwarm` 235、`daily_exhausted:pool=interactive` 67
- pools（Taipei 08-14 重置後）：`interactive` daily 240／used 0；`keepwarm` daily 960（base 480）／used 28；`backfill` daily 600／used 46。三池皆 `capacity=240, refill_per_min=1` → **每池每小時上限 60 次呼叫**
- 每檔每日 1 次 API 呼叫；`tw_chip_fact` 平均 **253.9 列／檔／日**
- 近 24h 實際完成分佈：多數小時僅 2 筆，08-13 08 時 61 筆 → **實際吞吐 ≈ 138 檔-日／天**

**關鍵數學（必須誠實面對）**：
- 每日新交易日需要 1551 檔 × 1 call；三池合計 **1800 calls/日**、且 refill 上限 180/hr。
- 即使把 Lane B 開到每小時 N=30、24 小時不停 → **720 檔-日／天 < 1551**。
- 結論：**per-stock 輪轉在現有配額下永遠追不上每日新資料**，只能做「歷史補洞」，不可能維持全市場當日新鮮。
- 但實測 08-11 有 **844 檔**、snapshot `source='finmind_market_batch'` 存在且 Edge 已實作 `fulfillDay`／`bsr_snapshot_fulfill_jobs` → **市場整批（1 次呼叫涵蓋全市場單日）才是唯一能達成全市場新鮮度的路徑。**

→ 因此 SLO 只能這樣定（若你不接受，Build2 就是 BLOCKED）：
- **Lane A（持倉，現行 universe 59–63 檔）**：expected latest date 覆蓋 ≥ 95%，T+1 09:00 前完成。以現吞吐（138/日）綽綽有餘。
- **Lane B（全市場 1551 檔）**：
  - B-1 市場整批：每交易日收盤後嘗試 `fulfillDay`（1–2 calls），成功即當日全市場新鮮；
  - B-2 per-stock 補洞（stale-first，N=20/hr → 480/日，佔 keepwarm 50%）：**只做歷史缺口收斂**，一圈 1551 檔 ≈ **3.2 天**；SLO 定為「任一 eligible 股票的最舊缺口 ≤ 7 個交易日」。

## 6. 最小變更面（待批准，尚未實作）
1. `CREATE OR REPLACE FUNCTION public.detect_chip_gap_jobs(...)` — 只換母體：`checkup_prefetch_universe()` → `observed universe ∪ 持倉 universe`，並改為 stale-first 排序（現為 `gap_count DESC`）。簽章不變。
2. job106 參數：`enqueue_chips_prefetch_gaps(10, 300)` → 需重新定額（Lane A 全量 ＋ Lane B N=20），可能改為 `(3, 80)` 級距，實作前以 §7 測試定值。
3. **不動**：`claim_bsr_queue_jobs`（frozen）、Edge worker、quota/defer、UI。
4. 需額外處理但**不需新物件**：1661 筆 `failed` 因 `active_uniq` 佔位使同 (stock,date) 無法重入 → 用既有 `recover_quota_failed_bsr_jobs` / `prune_bsr_sync_queue` 逐步消化。
5. **若你要 exact universe（排除興櫃/下市）→ 必須新增市場主檔，屬新物件，需另票。**

## 7. 測試與驗收（ephemeral SQL，deterministic）
- 選取邏輯：full-market selection、ETF(`0050`)／ETN／權證／非四碼排除、missing-first 與 oldest-gap 排序、tie-break `stock_id`
- 冪等：同輪重跑 inserted=0；queue dedupe 命中 `active_uniq`
- batch cap：`LIMIT N` 嚴格生效；Lane A 永遠排在 Lane B 之前（priority 1/2）
- quota stop：`finmind_admit_v2` 拒絕時不得吃 attempts（既有 `decideQuotaDeferral`）
- failed-date／非交易日／stale recovery 路徑
- production read-back：函式 `md5(prosrc)`／owner／`proconfig`／ACL 無漂移；`claim_bsr_queue_jobs` hash 必須仍為 `c28474cca7be420355edeefd6207104b`
- 三輪自然 `:02 → :07`：全市場 coverage 單調上升、Lane A 覆蓋不退化、`daily_exhausted` = 0
- Preview（authenticated，**不開抽屜**）：該帳號全部持股在 server 端已具最新 expected date 資料、前端 enqueue 次數 = 0

## 8. Rollback / Stop
- 只還原 `detect_chip_gap_jobs` 舊版本與 job106 參數；不刪任何資料
- 停 Lane B 條件：queue pending 發散（>3000 且連續 3 輪上升）、Lane A freshness 退化、任一 pool `daily_exhausted`、worker 錯誤率上升

---

### 待你裁決（缺一即 BLOCKED）
1. §1 選 **P1-a observed universe（不新增物件）** 還是 **P1-b 市場主檔（需新票）**？
2. §5 接受「Lane B 只保證歷史缺口收斂（一圈 3.2 天），當日全市場新鮮度改由市場整批負責」嗎？
3. 若接受，是否授權下一票只改 `detect_chip_gap_jobs` ＋ job106 參數？
