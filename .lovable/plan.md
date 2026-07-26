原本週日排程版是對的，但還不是最優。最優解應該是：**「偵測到缺口就回填，哪個資料源便宜/可靠就用哪個，週日只是自然發生的最佳時機之一」**。以下是在原本基礎上再往上推一層的計畫。

## 比原本更好的三個關鍵

1. **不要只等週日，要「缺口即觸發」**
   - 使用者今天（週日）問這個問題，代表週一開盤前可能會有人點開抽屜。等「下個週日」才回填太慢。
   - 最優設計是：發現 `tw_chip_fact` / `tw_bsr_daily` 缺 60 日資料 → 立刻進入回填佇列 → 用最低優先權在閒置時跑（週日、深夜、盤後）。

2. **不同資料用不同 Lane，哪個便宜用哪個**
   - **三大法人**：TWSE T86 官方 bulk API 已經在 PR-3 接入，且是免費/低成本 bulk。應優先用它回填歷史，而不是燒 FinMind quota。
   - **分點籌碼面 (BSR)**：FinMind 是主要手段；但如果官方或券商爬蟲有歷史資料，就寫進 `tw_chip_fact` 的同一 schema，由 materializer 統一競爭出最佳值。
   - **基本面**：財報是季資料，不該每天抓。用 FinMind 基本面 API 一次抓一季的 snapshot，寫入 `stock_fundamentals` 或擴充 `stock_names`；只在財報季更新。

3. **FinMind 要用 date-range，不是 per-day per-stock**
   - 你的記憶沒錯：FinMind 收費看「request 次數」。所以 `start_date=60days_ago&end_date=today` 和 `start_date=today` 成本一樣，但前者帶回 60 天。
   - 目前 `tw-bsr-finmind-sync` 一支股票一天一 call，這是最大浪費。

## 最優計畫：Gap-Driven Opportunistic Backfill

### Phase 1: 統一回填入口 `backfill-gap-orchestrator`
- 建立一個 Edge Function：接收 `(target_lanes, max_days, priority)`，
- 自動掃描缺口：
  - `tw_chip_fact` 缺哪些股票、哪些交易日，
  - `tw_bsr_daily` 哪些日期未 `ready`，
  - `tw_institutional_daily` 缺哪些日期，
  - `stock_fundamentals` 缺哪些季的財報。
- 把缺口轉成 jobs，寫入 `backfill_job_queue`（新表），欄位：lane, stock_id, start_date, end_date, source_preference, status, priority, created_at, attempts。

### Phase 2: 多源回填 worker
針對不同 lane 寫對應的 worker，但共用同一 job queue 與進度表：
- **Lane T86（三大法人）**：每個交易日 1 call 抓全市場三大法人，回填 `tw_institutional_daily`。優先順位最高。
- **Lane FinMind-BSR**：每支股票帶 `start_date`/`end_date` 一次抓多天，寫入 `tw_chip_fact`。使用 `backfill` quota pool。
- **Lane Fundamentals**：每季抓一次，使用 FinMind 財報資料集，寫入 `stock_fundamentals`。
- **Lane Broker-Scraper**：當 FinMind 缺資料時，啟用爬蟲；資料同樣寫入 `tw_chip_fact`，由 materializer 競爭。

### Phase 3: 排程：閒置時自動執行，但可隨時手動觸發
- 每日多次檢查（例如 02:00 / 14:00 / 22:00）：若目前系統負載低，就啟動回填 worker。
- 週日強制完整掃描：一次把整週累積的缺口掃完。
- 提供管理後台按鈕：「立即回填歷史籌碼面」，可針對單一股票或全市場。
- 提供 edge function URL：管理員可直接 invoke 手動觸發。

### Phase 4: 成本控制策略
- **Quota 分桶**：沿用現有 `interactive/keepwarm/backfill` 三 pool；backfill 只有在 pool 有餘額時才跑。
- **Smart Chunking**：若缺口跨 60 天，按「一個月一個 job」切；避免單一 request 過大導致 FinMind timeout。
- **Source 優先順序**：T86 免費/便宜 → FinMind date-range → Broker scraper → 付費 API。由 `backfill-gap-orchestrator` 根據成本和可用性動態選擇。
- **Deduplication**：寫入 `tw_chip_fact` 前先檢查 `(stock_id, trade_date, broker_code, source)` 是否已存在，避免重複抓取。

### Phase 5: 監控與管理後台
- 在 `/company/data-source-health` 新增「回填佇列」卡片：
  - 等待中的 jobs 數量
  - 本日/本週完成數量
  - 按 lane 分類的完成率
  - 失敗率與最後失敗原因
- 整合 `chips-guardian`：若回填佇列堆積超過 N 天未消化，發告警。

### Phase 6: 測試
- 單元測試：gap detection SQL、job chunking、source selection logic。
- E2E：手動 invoke 回填器，驗證 60 日缺口補齊；截圖 `/company/data-source-health` 顯示完成。
- 容量測試：估算上市櫃 1700 檔 × 60 日，若用 FinMind date-range 每檔 1-2 call，總 call 數在數千級；確認 admission control 不會讓它影響盤中互動。

## 為什麼比原本的週日-only 好

- **今天就能補**：不用等到下週日；偵測到缺口後馬上進佇列，閒置時自動跑。
- **不浪費 quota**：TWSE T86 先補三大法人、FinMind date-range 補分點，都是最低成本方式。
- **未來擴展**：加入 Broker scraper 或其他資料源時，只需新增 lane，不改架構。
- **可視化**：管理後台能直接看到「還剩多少缺口」，而不是下週日才知道有沒有補完。

## 風險與前置確認
1. 需要確認 TWSE T86 開放 60 日歷史查詢的格式與限制（是否有限流、是否需要特定參數）。
2. 需要確認 FinMind BSR 資料集 `TaiwanStockTradingDailyReport` 真的支援 `start_date` + `end_date` 同時帶；若實際不支援，則改用「按交易日清單 chunk」的方式，仍比現在每天一 call 好。
3. 基本面資料集需要確認 FinMind 的 dataset name 和欄位，避免抓錯。
4. 回填佇列必須有冪等機制：同一 `(stock_id, trade_date, source)` 不重複寫入。