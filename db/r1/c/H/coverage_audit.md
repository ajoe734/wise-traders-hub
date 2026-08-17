# H · Coverage Audit（read-only，production 0 touch）

量測時間：production 唯讀查詢（`SELECT` only）。本文件不含任何個資，僅彙總統計。

## 1. 來源／寫入者／新鮮度矩陣

| 資料域 | 表 | 寫入者（cron / edge） | 上游來源 | 最新資料日 | 覆蓋量 |
|---|---|---|---|---|---|
| 三大法人 | `tw_institutional_daily` | `tw-institutional-daily-sync` | TWSE T86 legacy JSON + TPEx 3insti | **2026-08-17** | 當日 15,386 rows；全表 19,026,661 rows |
| 日價量 | `daily_price_snapshots` | `backfill-snapshots-twse-bulk`（TWSE OpenAPI） | TWSE/TPEx OpenAPI | **2026-08-17（部分，142 檔）**；最後完整日 2026-08-14（1,462 檔） | 8/11=1,451、8/12=1,457、8/13=1,460、8/14=1,462 |
| 券商分點 BSR（raw） | `tw_bsr_daily` | `tw-bsr-worker-*`（FinMind） | FinMind `TaiwanStockTradingDailyReport` | **2026-08-14（卡住）** | 1,708 檔 |
| 券商分點 BSR（fact） | `tw_chip_fact` | 同上 | 同上 | **2026-08-14** | 1,675 檔 |
| 視窗彙總 | `tw_chips_rollup` | `rebuild_bsr_rollup`（抽屜讀取時／worker） | 衍生自 BSR raw | **2026-08-14** | — |
| 預取名單 | `chips_prefetch_targets` | `chips-prefetch-enqueue-hourly` | 內部需求 | — | 20 筆 |

結論：**三大法人與價量是新鮮的（8/17）；券商分點自 8/14 起停止推進**，原因為 BLOCKER-E1（FinMind BSR 端點 HTTP 400，且無其他授權免費全市場分點來源）。

## 2. 語意邊界（不得混淆）

- 「三大法人（外資／投信／自營商）」＝ TWSE T86 / TPEx 3insti，**官方、可用、每交易日更新**。
- 「券商分點（BSR）」＝ 各券商分公司買賣明細，**目前無可用授權來源**，資料停在 2026-08-14。
- 兩者**不得共用**同一顆 FRESH/STALE 徽章或同一個 `as_of`。`tw_chips_rollup.bsr_available` 這個單一旗標同時被兩種語意讀取，是既有技術債（列為後續 H 階段修正項，不在本次範圍）。

## 3. 前端呈現契約（本輪已落地）

- `ChipsSection` 新增 `data-testid="chips-freshness-segments"`，內含兩段：
  - `chips-seg-institutional`：`data-seg-state = fresh | lagging | no_data`，顯示自己的 as_of。
  - `chips-seg-bsr`：`data-seg-state = fresh | lagging | syncing | unavailable | unavailable_failed | ineligible`，
    不可用時明確顯示「目前不可用（上游來源中止）」。
- 頁首 `FRESH` / `STALE` 徽章加上 title，明示指的是「本次請求取得時間」，非資料日期。
- 映射邏輯集中在 `src/checkup/components/freecheckup/chipsFreshnessSegments.ts`（純函式，單一資料源）。

## 4. 抽屜寫入路徑盤點（H5）

| 路徑 | 是否寫入 | 現況 |
|---|---|---|
| 前端開抽屜 → `useChipsLifecycle` → `tw-chips-detail` GET | 前端無寫入 | ✅ 已無 `ensure_bsr_queued` / `ensure_bsr_window` 呼叫 |
| 前端「回補 60 日」按鈕 → `enqueue_bsr_backfill` | 寫入 | ✅ 使用者顯式操作，保留 |
| 後端 `tw-chips-detail` → `rebuild_bsr_rollup` | **寫入 `tw_chips_rollup`** | ⚠️ 尚未收斂：讀取仍可能觸發彙總重建 |
| 後端 `tw-chips-detail` → `makeInflightHook`（`finmind_inflight_requests`） | 寫入（請求簿記） | 觀測用，非市場資料 |

**未完成項（需另行核准的 stage）**：把 `rebuild_bsr_rollup` 改為 `allow_rebuild=1` 顯式參數（預設關閉），由 worker/cron 負責重建。此改動會觸及 edge function 部署，故不在「production 0 touch」的本輪範圍內。

## 5. Stage 邊界

- 本輪交付：唯讀盤點文件、H6 分段新鮮度 UI + E2E、H-ACL v2 caller 準備（含 fallback，不撤舊 grant）。
- 未觸及：production migration、cron、edge function 部署、Publish。
