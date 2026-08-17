# 修正版 Plan v8：不重複建 ingest，收斂語意與分型 freshness UI

Production 0 touch。以下所有「現況」皆為本回合唯讀實測。下一個 Approve 只授權：read-only coverage audit 文件化 + H5/H6 controlled Preview/E2E + H-ACL guarded v2 前端 caller 準備。**不 Publish、不 production、不 deploy、不動 cron、不做 H3/H4 ingest。**

## 1) 法人 pipeline 唯讀稽核：已存在且新鮮 → 禁止再建第二條

Writer / 來源 / 排程（實測）：

- Edge `tw-institutional-daily-sync`，官方來源就是 **TWSE T86 legacy JSON**（`www.twse.com.tw/rwd/zh/fund/T86?...response=json`，即上輪 probe 3/3 穩定那支）；per-stock 回補另走 FinMind `TaiwanStockInstitutionalInvestorsBuySell`。
- 寫入路徑 `upsert onConflict=(stock_id,trade_date)`，sealed 交易日會被跳過（權威快照不可改寫）。
- cron 共 6 條 natural run chain：`tw-institutional-daily-sync`（45 9 * * 1-5）、`tw-institutional-fastlane`（每小時）、`tw-inst-keep-warm-wave1/2/3`（TW 15:30 / 17:30 / 19:30）、`tw-inst-cold-start-resume`（每 5 分）、`tw-inst-backfill-enqueue`（每小時）。
- 其他讀者：`alerts-watchdog`、`tw-chips-detail`、`tw-bsr-daily-sync`、`backfill-worker`、`_shared/institutionalConsistency.ts`、`_shared/chipsStamp.ts`。

近 7 日每日 rows / distinct symbols：

| trade_date | rows = distinct symbols |
|---|---|
| 2026-08-17 | 15,386 |
| 2026-08-14 | 20,794 |
| 2026-08-13 | 21,275 |
| 2026-08-12 | 20,697 |
| 2026-08-11 | 19,913 |
| 2026-08-10 | 20,433 |

**結論：法人 ingest 已用官方來源且已到最新交易日 → 不新建第二條 official institutional ingest。**

但唯讀查出三個真實缺陷（都屬語意/observability，不需新 ingest）：

1. **無 market 欄位**：8/17 的 15,386 列全部來自 TWSE T86；抽樣 OTC（3105 / 5483 / 00679B）8/17 **無資料**，8/11–8/14 才有 → TWSE 與 TPEx 的 as_of 事實上不同，schema 卻無法表達，前端只能看到單一「最新日」。
2. **無 eligibility gate**：15,386 = 全部 6 碼商品（權證為主），權證與 unknown 都被寫進來，`source` 欄位 100% 是 `'unknown'`。
3. rows 由 20,7xx 掉到 15,386 是「TPEx 尚未進來」造成，不是掉資料——但目前沒有任何指標能區分這兩者。

## 2) 價量 pipeline 唯讀稽核：同樣已有全市場批次

- 全市場批次 Edge `backfill-snapshots-twse-bulk`，官方來源 **TWSE OpenAPI `STOCK_DAY_ALL`**，cron `15 7 * * 1-5` + 週末 `20 7,13 * * 6,0`（含 `refreshCoverage`）。
- 另有 `stock-price-sync`（收盤 / 收盤校正）、`daily-snapshot`、`backfill-daily-snapshots`（每 5 分續跑）、US/crypto/option 各自的 sync。
- `daily_price_snapshots` 每日 distinct symbols：8/10–8/14 皆 1,45x–1,46x（全市場），8/17 目前 142（當日批次尚未跑完/僅需求集）。
- `current_prices`：TW 101 / US 26 / CRYPTO 15，`updated_at` 皆為今日。

**結論：價量已有全市場批次 → 不新建 ingest。** 缺的同樣只是 market-aware as_of 與「今日尚未完成」與「失敗」的區分。

## 3) 需求面 privacy-safe aggregate（`checkup_storage` key=`pf-holdings-v2`）

只輸出彙總，**不列 user_id、不列 quantity/cost、不列任何個人組合**：

- 38 位使用者、46 筆持股列、**43 個 unique normalized symbols**（0 個空代號）。
- market 欄位：43/43 為未填（`?`）→ 需求面本身就沒有 market 語意，這是前端要補的。
- 自填 type：股票 30、權證 13（自填值，未經 ISIN 驗證，可能與官方分類不符）。

逐 symbol 集合對比（43 檔）：

| 指標 | 命中數 |
|---|---|
| 價量 @2026-08-14 | 42 / 43 |
| 價量 @2026-08-17 | 42 / 43 |
| 法人 @2026-08-14 | 38 / 43 |
| 法人 @2026-08-17 | 28 / 43（差額即 TPEx 尚未進來） |
| BSR 分點 @2026-08-14 | 29 / 43 |
| BSR 分點 曾經有過 | 30 / 43 |
| BSR 最新 as_of | **2026-08-14**（已落後 1 個交易日） |
| unsupported / parse-failed | 0 筆解析失敗；13 檔自填為權證，官方分類下多屬 unsupported |

**界線聲明**：以上只涵蓋雲端同步過的持股。使用者若只存在瀏覽器 localStorage（未登入或未同步），production read-only **無法涵蓋**，其需求集不在這 43 檔之內；任何「覆蓋率 100%」的說法都僅限雲端集合。

## 4) 重畫後的 critical path

- **法人 / 價量**：既有 pipeline 沿用，不新建 ingest。只做 (a) market-aware as_of 的呈現、(b) observability 區分「未完成 / 失敗 / 已完成」。
- **BSR 分點**：BLOCKER-E1（無合法免授權來源）。queue / master / registry **不得**被描述成能解決「來源不存在」；它們解決的是排程與需求管理，不是資料可得性。不承諾全市場 hourly freshness。
- **近期真正能完成的**：
  - **H5 drawer read-only**：抽屜開啟不再觸發寫入（cache miss 不寫、不 enqueue），只讀既有資料。
  - **H6 分型 freshness UI**：價量、三大法人各自顯示自己的 as_of（含 market 區分）；BSR 顯示 `stale`（有舊資料，標明 as_of）或 `unavailable_no_source`（從未有過），且**整體徽章不得因法人新鮮就顯示 fresh**。
- **H1 market master / H2 registry**：降級為「未來 provider 就緒時的準備」，是否上 production **另案決定**，不是本次完成條件。

## 5) 下一個 Approve 範圍

1. **Read-only coverage audit 文件化**：把第 1–3 節結果寫成 `db/r1/c/H/coverage_audit.md`（含 writer/cron/source 矩陣、每日 coverage、43 檔對比表、localStorage 界線）。純文件，不動 DB。
2. **H5/H6 controlled Preview + E2E**：抽屜改 read-only、分型 freshness UI；在 Preview 驗證，加 E2E（法人新鮮＋BSR stale 時整體不得標 fresh、cache miss 不觸發寫入）。**不 Publish。**
3. **H-ACL guarded v2 前端 caller 準備**：DataSourceHealth 準備好呼叫 v2 的分支（feature-flag 或 fallback 舊函式），程式碼就緒但**不撤任何舊 grant、不 Publish**。

明確不做：H3/H4 官方 batch ingest（重複建設）、任何 production migration、cron 變更、deploy、Publish。

## 6) 最終可驗收標準與真實 blocker

可驗收（本階段能保證的）：

- 開抽屜不再產生任何寫入（read-only，可由 E2E + 無新增 queue/fact 列證明）。
- 既有資料如實顯示：價量 as_of、法人 as_of（分 market）、BSR as_of 或「不可用」。
- 法人與價量在背景排程下維持新鮮（沿用既有 cron，不新增）。
- BSR 只要不是當日資料，UI 一律標 `stale` 或 `unavailable_no_source`，永不冒充 fresh。

真實 blocker（不可迴避、不可用 UI 掩蓋）：

- **BLOCKER-E1**：無合法 BSR（券商分點）provider。在此之前**不得**聲稱「全市場分點已新鮮」，也不得用 queue/registry/master 的完成度暗示分點可得。
- **TPEx 法人當日落後**：8/17 只有 TWSE，需 market-aware as_of 才能誠實表達（本階段以 UI 表達，不改 ingest）。
- 未同步到雲端的 localStorage 持股不在任何 coverage 保證範圍內。
