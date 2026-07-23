## 目標

讓「所有活躍持倉 TW 個股」在抽屜的 BSR 區塊都能穩定顯示「集中度：買超前 15 大占 X%」，並且每一種資料狀態都有明確、被驗證的根因修法。不是「哪隻沒出來修哪隻」，而是把每一種會導致「沒出來」的路徑一次補上。

## 現況（已核實）

- `tw_chips_rollup`：211 檔已有 rollup，4623 筆 `concentration_ratio` 全部 non-null；`bsr_available=true`。
- Edge `tw-chips-detail`：對 2313 / 4576 / 2881 實測回傳 `bsr.d5.concentration_ratio = 58.35`（數字型別，非字串），資料鏈路 OK。
- Queue：P1 pending 48、P2 pending 68；324 檔 `never_done`（多為 020xxx／030xxx 權證，已 `skipped`，合預期）。
- Frontend：`ChipsSection` 讀 `data?.bsr?.d5 || d20 || d60`，直接 `.toFixed(0)`。

換句話說：**已有資料的個股「集中度」實際會顯示**；用戶說「全部個股都沒出來」的最合理解釋是他抽的個股落在「rollup 尚未產出／raw 有但 rollup 沒 rebuild／queue 卡 pending」這幾個坑上。**根因分類修法** 覆蓋這些坑，才是符合最高行為準則的做法。

## 待辦（照類別修，不照個股修）

### 1. 全域審計腳本（先量再修）

新增 `scripts/audit-bsr-concentration.mjs`：
- 掃全站活躍 TW 4 碼持倉（`trade_records` 未清倉 + `checkup_storage.holdings`）。
- 對每檔輸出 `{stock_id, has_rollup, rollup_as_of, bsr_available, concentration_ratio, raw_days, queue_state, ineligible_reason}`。
- 分桶統計並落 `/tmp/bsr-audit-*.csv`；納入 nightly CI。
- 這份是後續每一步的驗收基準。

### 2. Backend 根因修法（`supabase/functions`）

- **`tw-bsr-finmind-sync` worker**：`rebuildRollup` 完成後，若 `computeBsrWindow` 為 null（raw < 5 rows）→ 保持 `pending/skipped` 不寫 rollup（現行行為，確認保留）；若非 null → 必須 upsert **三筆**（w=5/20/60）並強制 `bsr_available=true` 與 `concentration_ratio=computeBsrWindow().concentration_ratio`。今日抽查同一份 helper，兩邊數字必一致。
- **`tw-chips-detail` 自癒**：若 `rollupRows` 為空、但 `bsrRawRows` 有 ≥ 5 rows 的日期（fallback complete）→ 直接以 `computeBsrWindow` 現算三窗回傳 `bsr_source='raw_fallback'`（目前只算 d5，擴到 d20/d60 供前端全部窗口都能顯示集中度）。同時背景送 `pg_notify` 或直接呼叫 `rebuildRollup`，讓下次不用即算。
- **Queue 排隊完整性**：新增 DB function `public.enqueue_all_active_tw_holdings_bsr()`，掃 `trade_records` 未清倉 + `checkup_storage.holdings` 中 `^[1-9][0-9]{3}$` 個股，補 P1 pending（含今日）與最近 5 個交易日 P2 缺口。目前 `tw-bsr-enqueue-holdings-delta` 只補 tier1 今日；擴充成 tier1 + tier2 缺口。

### 3. Frontend 防禦（`ChipsSection.tsx`）

- `bsrLatest.concentration_ratio` 一律 `Number(...)` 後再 `.toFixed(0)`；PostgREST 未來若改回 string 也不會壞。
- `bsrLatest` fallback 順序：`d5 || d20 || d60`（現況）；並在 `top_buy/top_sell` 空但 `concentration_ratio` 有值時仍渲染集中度那一行。
- 若後端回 `bsr_source=null`，明示區分「尚未排入」「排隊中」「上游無資料（權證/ETF）」三種文案，用 `data.bsr_freshness_status` / `ineligible_reason` 驅動。

### 4. 一次性資料修復

- 對現有 211 檔以外、屬「活躍持倉」且未 `skipped/ineligible` 的個股：
  - 用新 RPC 一次入隊 tier1（今日）+ tier2（近 5 日）。
  - 用 `mode=worker, max_priority=1, budget_ms=45000` 手動燒完 P1；不動全域降級狀態（現在是 normal）。
- 對 rollup 存在但 `bsr_available=false` 或 `concentration_ratio IS NULL` 的舊列：`DELETE` 後由下一輪 worker 重寫（避免 upsert 帶入舊壞值）。

### 5. 回歸測試與監控

- 單元：`bsrRollup.test.ts` 加「computeBsrWindow → rebuildRollup 必寫 concentration_ratio 且與 helper 完全相等」。
- 整合：`tw-chips-detail` 對「無 rollup、有 raw ≥ 5 rows」個股必回 `raw_fallback` 且 `concentration_ratio` 非 null（d5/d20/d60 至少 d5）。
- E2E：`e2e/chips-section.spec.ts` 新增「mock d5 concentration_ratio=58.35 → 畫面必出現 `集中度：買超前 15 大占 58%`」。
- Ops：`/company/bsr-rate-limit` 新增一列「活躍持倉集中度覆蓋率 = has_concentration / active_tw_holdings」，低於 95% 觸 `system_alerts.kind='bsr_concentration_coverage_low'`。

### 驗收

1. `scripts/audit-bsr-concentration.mjs` 覆蓋率 ≥ 99%（扣除權證/ETF/新上市 ineligible）。
2. 隨機抽 20 檔活躍 TW 持倉，抽屜 BSR 區塊「集中度」那一行必渲染，數字與 `computeBsrWindow` 一致。
3. 新增的單元 / 整合 / E2E 全綠。
4. 監控儀表板顯示覆蓋率 ≥ 95%，24h 內無 `bsr_concentration_coverage_low` 告警。

## 技術細節（給工程審閱）

- `numeric(5,2)` 經 PostgREST 目前回傳 number（實測），但 `Number()` 包裹是零成本保險。
- `computeBsrWindow` 已是 rollup 與 raw_fallback 共用；rebuildRollup 那條路徑若歷史上曾直接寫 DB 而不走 helper，需改成呼叫 helper 保證一致。要在 `tw-bsr-finmind-sync/index.ts` 內確認並修正。
- 一次性資料修復用 SQL migration 執行 DELETE + RPC enqueue；worker 燒完 P1 走 edge function invoke，不放進 migration。
- `enqueue_all_active_tw_holdings_bsr` 需 `SECURITY DEFINER` + 嚴格 regex `^[1-9][0-9]{3}$`（延用先前修法），避免權證 6 碼被截。
