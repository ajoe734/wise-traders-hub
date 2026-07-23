## 自我審視（用最嚴厲角度挑戰前三版）

以下是我對自己前三版計畫的實質性反駁；每一條後面接「怎麼改」。

---

### 挑戰 1：「Market-scope 每日 1 呼叫」是空中樓閣

**問題**：我假設 FinMind 有「全市場 BSR」單一端點。實際上 FinMind 的分點資料 (`TaiwanStockShareholding`) 是**按股票查詢**的，沒有一次拉全市場的 BSR 端點。三大法人 (`TaiwanStockInstitutionalInvestorsBuySell`) 才有整日。

**修正**：
- 三大法人：改成 market-day 批次（真的能省），這條保留。
- BSR：仍是 per-stock-per-day。**改為以「每檔的 60 日區間查詢」代替「單日 60 次查詢」**——若 FinMind 支援 `start_date/end_date`，1 檔補 60 天只花 1 次呼叫；若不支援，維持單日但用桶預算限流。
- Plan 必須在開工前先做一次 **FinMind 端點 spike**（半天）驗證每個 dataset 的 date 範圍語意，把結論寫進 `docs/ops/bsr-finmind-runbook.md` 再動手。

---

### 挑戰 2：「Demand-Weighted Scheduling」邏輯漂亮但沒有 SLO

**問題**：加權後低分股票可能永遠排不到，但那可能是唯一用戶的唯一持倉，對他而言就是壞掉。

**修正**：
- 加**保底 SLO**：任何 active 持倉，24 小時內至少要把 d5 補到 ready，無論分數多低。
- 排序改成 `max(demand_score, age_bonus)`：age_bonus 隨排隊時間線性上升，避免飢餓。
- Dashboard 需要顯示「保底違反次數」KPI，違反即 P1 告警。

---

### 挑戰 3：桶化預算的三個桶是拍腦袋的比例

**問題**：40/40/20 沒有數據支持。且「借用」邏輯若寫錯會讓 Backfill 桶反噬 Live 桶。

**修正**：
- 上線先跑 2 週單桶 + 觀察，用實際 `tw_bsr_api_usage` 分布決定切法。
- 借用只單向：Live → Fill → Backfill，不可反向。
- 每桶各自的 rate limiter 用同一支 `reserve_bsr_quota` RPC，桶名當參數；桶間切換由排程層決定，不做「動態借用」，直接每小時重算比例。避免動態邏輯錯誤。

---

### 挑戰 4：物化表 `tw_series_readiness` + `tw_bsr_market_days` + `demand_snapshot` = 三張新表

**問題**：新表 = 新 RLS + 新 grant + 新 trigger + 新遷移風險。前面已經有一堆 BSR 相關表，再加三張很可能重複職責。

**修正**：
- `tw_series_readiness` 合併進既有 `tw_chips_rollup` 加欄位即可（`complete_days_5/20/60`, `state_5/20/60`, `upstream_oldest`, `ready_since`）。
- `tw_bsr_market_days` 精簡為 `tw_bsr_daily_summary`（既有 `tw_bsr_sync_metrics` 若可擴展就直接擴展）。
- `demand_snapshot` 不建表，改為 SQL view 直接對 `trade_records` 聚合，每小時 `REFRESH MATERIALIZED VIEW CONCURRENTLY`。
- 新表數目：0–1 張，不再是 3 張。

---

### 挑戰 5：狀態機文案七個 state 對前端是負擔

**問題**：`ready / partial / insufficient / no_data / ineligible / upstream_exhausted / syncing / sync_failed / lagging / not_queued / fresh` 加起來 11 個，UI 團隊會抓狂，測試矩陣也爆炸。

**修正**：對使用者只有 4 個：
1. **就緒** — 直接看
2. **補齊中** — 顯示 ETA
3. **上游不足** — 顯示最早可用日
4. **暫無資料** — 說明原因（1 行）

內部 debug 狀態保留在 payload 但不上 UI。UI 測試矩陣從 11 縮到 4。

---

### 挑戰 6：ETA「預估 15:47 完成」是承諾陷阱

**問題**：一旦顯示具體時間就是承諾，估錯用戶會截圖罵人。FinMind 429、上游延遲都會讓 ETA 崩。

**修正**：
- 不顯示絕對時間。
- 顯示相對進度：「已補 X/Y 個交易日，通常 10–30 分鐘內完成」。
- 若 > 30 分鐘未完成，切成「補齊時間比預期長，正在重試」，不承諾新時間。

---

### 挑戰 7：Planner 產出的 dates 集合可能無限膨脹

**問題**：60 日視窗 × 假日 × 上游空 = 每次都會產出一大堆日期，Queue 表撐大。

**修正**：
- Planner 一次最多產出 `min(missing, 10)` 個日期，剩下等下一輪。
- Queue 內同 (stock, date) unique；planner 用 `INSERT ... ON CONFLICT DO NOTHING`。
- 每晚 vacuum sealed job（status=done 且 trade_date < today - 90）。

---

### 挑戰 8：「抽屜開啟不觸發同步」與「使用者期望即時看到」衝突

**問題**：新用戶剛加持倉打開抽屜，什麼都沒有，等 30 分鐘。體感很糟。

**修正**：加**加入持倉時的一次性優先權提升**（不是抽屜開啟時）：
- `trade_records` AFTER INSERT trigger（已存在）順便把該檔 tier1 job priority 提到 P0。
- 使用者第一次為新持倉打開抽屜，顯示「首次收集，通常 5 分鐘內」，允許輕度樂觀。
- 抽屜本身仍不打 FinMind，避免併發放大。

---

### 挑戰 9：測試矩陣提太多但沒說怎麼在 CI 跑

**問題**：10 條 E2E + property test + DB invariant + coverage KPI，跑一次要多久沒說。CI 已經很慢。

**修正**：
- Property tests 進 unit（<10s）。
- Contract tests 進 vitest（<30s）。
- E2E 只保留 3 條關鍵路徑（首次持倉、切窗口、上游 exhausted），其他移 nightly。
- DB invariant 走 nightly cron 而非每次 push。

---

### 挑戰 10：整體體量對「一個 bug」不成比例

**問題**：用戶原始抱怨是「5 日不足往回朔」。我開了三張表、四個桶、planner、readiness view、狀態機、demand 加權。這是過度工程。

**修正**：**分成 3 個 milestone，第一個 milestone 就能解掉用戶眼前的 bug**。

---

## 修正後的最終計畫（三個 Milestone）

### M1 — 眼前 bug 收斂（1–2 天，能上線）

只做三件事解掉「至少需要 5 個交易日」誤字：

1. 新純函式 `_shared/seriesReadiness.ts`：判定 4 種對外狀態。
2. `tw-chips-detail` 加 `readiness_by_window`（並存舊欄位）。
3. `ChipsTrendChart` 改讀 readiness，四狀態文案；移除「至少 N 個交易日」字串。

**驗證**：對截圖那檔的實際回傳做 contract snapshot；grep 全 repo 確認舊文案已刪。

### M2 — 收斂式排程與物化就緒欄位（1 週）

1. `tw_chips_rollup` 加 readiness 欄位（不建新表）。
2. `plan_series_backfill(stock_id)` RPC + planner-based enqueue。
3. `enqueue_all_active_tw_holdings_bsr` 改為呼叫 planner。
4. 一次性 repair 腳本，覆蓋率 audit CSV。
5. UI 上部細字提示補齊進度（相對進度，不承諾時間）。
6. 新持倉 AFTER INSERT 提 priority P0。

**驗證**：覆蓋率 KPI ≥ 95%；保底 SLO 違反 = 0。

### M3 — FinMind 額度效率（2 週，等 spike 完成才動）

1. **前置 spike**：實測 FinMind BSR/institutional 每個 dataset 的 `start_date/end_date` 行為，寫進 runbook。
2. 三大法人改為 market-day 批次。
3. BSR 改為「單檔區間」呼叫（若上游支援）。
4. Sealed 日永不重抓（`tw_bsr_daily.sealed_at`）。
5. 桶化限流：先 3 桶 60/30/10 靜態切分，觀察 2 週再調。
6. Demand view 加權排序 + age bonus 保底。

**驗證**：FinMind 每日呼叫數下降 ≥ 3 倍；覆蓋率不降；保底 SLO 違反 = 0。

---

## 明確承認的取捨

- M1 完成後截圖 bug 就解了，但整體效率沒變。這是刻意的：先止血再手術。
- M2 增加 DB 寫入次數（每 job 完成 upsert readiness），換取查詢時複雜度歸零。
- M3 前置 spike 若發現 FinMind 不支援區間查詢，M3 大幅縮水，只剩 sealed + 桶化。這條 M3 必須先驗證再排時程。
- 不做 real-time ETA、不做動態桶借用、不做新表爆炸。刻意選擇「簡單能動」勝過「聰明會壞」。

## 明確不做

- 不換上游、不加額度、不改 UI 版型。
- 不承諾具體完成時間。
- 不在 UI 露 11 個內部 state。
- 不做動態桶借用。
- 不建 3 張新表。