# 關鍵分點加上 1／5／10 日視窗

## 現況（已查證）

- 抽屜「關鍵分點」目前**寫死近 5 日**：UI 取 `bsr.d5 || bsr.d20 || bsr.d60`，標題固定「關鍵分點（近 5 日）」，沒有切換器。上方 1/5/20/60 的切換器只作用在**三大法人**，不影響分點。
- 後端 `tw-chips-detail` 只組 `d5 / d20 / d60`；寫入端（`tw-bsr-finmind-sync`、`_shared/snapshotFulfillment.ts`）也只把 rollup 寫成 `window_days` 5／20／60。所以「1 日」「10 日」目前資料庫層根本沒有這兩個窗口。
- 每日的確有在抓：`tw-bsr-worker-trading`（週一～五 14–20 台北，每 10 分）、三波 orchestrator（15:35/17:35/19:35）、`tw-bsr-window-converge-halfhour`（每 30 分收斂窗口）。
- **週末沒有新分點可抓**：TWSE 週末不開盤、上游無當日資料，因此每日抓取排程限定週一～五是正確設計。週末仍有 `backfill-gap-orchestrator-sunday`（週日 18:00 台北）補「平日漏掉的交易日」。這部分不需要改，會在 UI 文案講清楚。

## 要做什麼

1. **分點窗口擴充為 1／5／10 日**（保留 20／60 作為既有資料，不刪）
   - 寫入端：`tw-bsr-finmind-sync` 與 `snapshotFulfillment` 的 `[5,20,60]` 改為 `[1,5,10,20,60]`，同一交易日一次寫齊；`window_days=5` 仍維持「當日 broker_count 事實列」的既有角色不變。
   - 讀取端：`tw-chips-detail` 的 rollup 讀取與 raw fallback 聚合都加上 `d1 / d10`；raw fallback 已抓近 14 個交易日，足以現算 1 日與 10 日，不需要額外查詢。
   - readiness：`_shared/seriesReadiness.ts` 的 `WINDOWS` 加入 1 與 10，讓「補齊中 N/10」能正確顯示，不會用 3 天資料假裝 10 日完成。

2. **UI 加分點視窗切換器**
   - 「關鍵分點」標題列右側新增 1日／5日／10日 三顆切換（與三大法人切換器同一視覺語彙），預設 5 日。
   - 買超前 3／賣超前 3／集中度隨選取窗口切換；該窗口資料未齊時顯示「補齊中 N/10」而非空白。
   - 選取值用既有 `prefsStore` 記住（每次開抽屜沿用上次選擇）。

3. **歷史窗口回填**
   - 新增一次性回填：對既有 `tw_bsr_daily` 已有的交易日，補算並寫入 `window_days = 1` 與 `10` 的 rollup 列，避免上線後只有當天之後才有 1／10 日。
   - 走既有 `materialize` / converge 路徑，不新開資料表。

4. **文案修正**
   - 分點區塊底部說明改為明確：「僅交易日（週一～五）有新資料；週末與國定假日不更新，週日會自動補齊本週漏抓的交易日」。

## 技術細節

- 資料表 `tw_chips_rollup` 的唯一鍵是 `(stock_id, as_of_date, window_days)`，新增 1／10 只是多兩列，**不需要 schema migration**。
- 型別：`TwChipsPayload.bsr` 由 `d5|d20|d60` 擴為含 `d1|d10`，以可選欄位方式加入，舊消費者不壞。
- 測試：
  - `seriesReadiness` 單元測試補 1／10 窗口案例。
  - `tw-chips-detail` fallback 聚合的 Deno 測試補 d1／d10 斷言。
  - `e2e/chips-section.spec.ts` 補「切到 1 日／10 日後買賣超與集中度會變、且 as-of 標籤不重複」。
  - 手機斷點（560/390/380）確認切換器不撐破抽屜。
