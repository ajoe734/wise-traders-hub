# 01 — 會員週記頂部顯示老師目前持股

Status: ready-for-human
Priority: P1
Category: feature
Blocked by: None — can start immediately

## What to build

會員開啟每週週記詳情時，能在老師與週次資訊下方直接看見該老師目前仍持有的部位，並以清楚的卡片矩陣比較成本、現價與未實現損益。

## 驗收標準

- [x] 訂閱會員在 `/app/journal/:id` 開啟週記時，老師／週次資訊後、本週標題前顯示「目前持股」。
- [x] 桌面三欄、平板兩欄、手機單欄；預設顯示前三檔，超過三檔可「查看全部」及收合。
- [x] 每張卡顯示代號、名稱、持有數量、平均成本、目前現價、未實現損益與報酬率。
- [x] 正報酬使用台股紅色語意、負報酬使用台股綠色語意；股票名稱維持最高對比。
- [x] 初次載入、零持股、讀取失敗、投影資料檢核中、缺現價與重新整理皆有明確狀態。
- [x] 缺現價時保留名稱、成本與數量，現價／損益／報酬率顯示「報價更新中」，不推算假數字。
- [x] 股／張／顆／口／組皆沿用持倉單一資料源已換算的顯示值。
- [x] 手機（560 / 390 / 380px）與桌面（1280px）版面正常，無溢出。
- [x] 既有週記與持倉測試全綠，並新增元件及 e2e 測試覆蓋上述行為。

## 頁面／路由清單

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/app/journal/:id` | 修改 | 需登入、`subscriberOnly` | 在週記頂部插入目前持股卡片矩陣 |
| `/e2e/journal-current-holdings-harness` | 新增 | 僅 localhost／Preview runtime guard | 彥愷六檔假資料與完整狀態的視覺驗收入口 |

深連結與導向：

- 進入點：會員戰情室週記列表、老師頁面、既有週記分享連結。
- 失敗導向：沿用 `/app/journal/:id` 現有登入與訂閱准入；持股讀取失敗不離開週記頁。
- 是否需要更新 `public/sitemap.xml`：否；會員頁與 e2e harness 均不列入 sitemap。

## 資料來源

**讀取**

| 來源 | 型別 | 欄位／回傳 | 權限 |
| --- | --- | --- | --- |
| `useExpertHoldingsBundle(signal.expert_id)` | 前端單一資料來源 | `openPositions`、`currency`、`assetClass`、`projection`、載入／錯誤／更新狀態 | 沿用既有登入會員可讀 RPC 與公開投影遮罩 |
| `get_expert_capital_status` | RPC（由上述 hook 內部呼叫） | `open_positions`、`currency`、`asset_class` | 沿用現有 RPC 與 RLS；本功能不新增直連 |
| `calculate_expert_performance` | RPC（由上述 hook 內部呼叫） | 績效彙總；本區塊不另外顯示 | 沿用現有 RPC 與 RLS |
| `public_expert_state_active` | 公開投影狀態（由上述 hook 內部呼叫） | `state` 與檢核計數 | 非 ready 時強制遮蔽經濟數字 |

**寫入**

| 來源 | 動作 | 權限與稽核 |
| --- | --- | --- |
| 無 | 不寫入 | 展開／收合只存在當前頁面狀態 |

**衍生規則**

- 單位：資料庫數量維持 base unit；顯示值只使用 `useExpertHoldingsBundle` 經 `resolvePositionQuantityDisplay` 的結果。
- 幣別：優先持倉 bundle，fallback 至 `experts.currency`；不做匯率換算。
- 價格權威：只顯示 RPC 回傳的成本與現價；缺現價不推算。
- 快取與更新頻率：沿用 bundle 30 秒 staleTime 與 `trade_records` realtime invalidation；相對時間使用共用 freshness ticker。

## Out of scope

- 不建立週記發布當下的歷史持股快照。
- 不新增或修改資料表、RLS、權限、RPC、Edge Function、交易或損益公式。
- 不修改 PDF 匯出、週記分享或正式站發布狀態。

## Comments

- 2026/10/06：使用者選定「現代卡片矩陣」，正式版移除樣本陰影與大圓角，收斂至 legendflow 米白細框語言。
- 2026/10/06：完成正式頁接入與完整狀態驗收；Vitest 3,925 項、相關 Playwright 58 項、型別與模組邊界均通過，待人工確認 Preview 後發布。