# P0 週記「內容消失」事故 — 唯讀取證報告

As-of: 2026-08-18T02:35Z（UTC）。Production 全程唯讀：只執行 SELECT / COPY TO STDOUT。
0 DELETE / UPDATE / DDL / migration / seed / deploy / publish。

## 0. 結論（先講）

**沒有任何資料被刪除或清空。** `expert_signals`（老師週記原文）與 `trade_records`
（持股）在 production 皆完整。畫面上「內容消失、0 股、進場價／現價／損益／報酬皆為 -」
是 **前端讀取層 fail-closed 閘門** 造成的顯示遮蔽：

- 閘門讀取 view `public.public_expert_state_active`。
- 這個 view **在 production 不存在**（`information_schema.tables` 查詢回傳 0 列）。
- 契約規定「view 不存在 = pre-cutover = fail-closed」→ `NO_PROJECTION` /
  `UNKNOWN_PROJECTION` → `showNumbers=false` → `gatePositionRows()` 把
  `quantity / base_quantity / entry_price / current_price / pnl / pnl_percent`
  一律覆寫為 `null`，`gateSignalEconomics()` 把 `price_hint / quantity` 覆寫為 `null`。
- UI 把 `null` 股數畫成「0 股」、把 `null` 價格畫成「-」。

因此 **不需要資料復原（restore/merge）**，需要的是解除或修正閘門。

## 1. 讀取鏈（exact）

| 層 | 位置 |
|---|---|
| 路由（老師後台） | `/admin/:expertSlug/signals`、`/admin/:expertSlug/signals/new`、`/admin/:expertSlug/signals/edit/:batchId`（`src/App.tsx` L402-404） |
| 路由（訂閱者） | `/app/journals`、`/app/journal/:id`（L331/333） |
| 後台 hook | `src/hooks/useAdminSignals.ts` → `fetchAnalystSignals()`（`src/lib/analystDataAccess.ts` L27-38，`select *` from `expert_signals`，**未經閘門**） |
| 後台持股 | `useAdminSignals` L76 → `src/hooks/useExpertHoldingsBundle.ts` L158-160 → `gatePositionRows` / `gatePerformance` / `gateCapital`（**經閘門**） |
| 其他經閘門的後台頁 | `src/hooks/admin/useSignalEditorData.ts` L42、`src/hooks/admin/useAdminPerformanceData.ts` L51、`src/hooks/usePerformance.ts`、`src/hooks/usePeriodPerformance.ts` L312、`src/components/strategy/PerformanceOverviewPanel.tsx` L66、`src/components/admin/FactsheetExportDialog.tsx` L69 |
| 前台週記列表 | `src/pages/app/Journals.tsx` L129-132 → `fetchProjectionStatusForExperts()` → `journalRepository.forSubscriber()` L85-88 → `gateSignalEconomics` |
| 閘門實作 | `src/contracts/publicEconomicContract.ts`、`src/contracts/publicProjection.ts` |
| 閘門資料源 | `src/hooks/useProjectionStatus.ts` L26-28、`src/lib/fetchProjectionStatus.ts` L30-31：`from('public_expert_state_active')` |

老師原文（`reason_summary` / `reason_detail` / `learning_points`）與持股數字
**同一張表** `expert_signals`；持倉彙總另在 `trade_records`。閘門只清數字欄位，
**不清文字欄位** — 這解釋了「數字全空、文字仍在 DB」。

## 2. Production 實際資料（唯讀）

`expert_signals`：total **173**、published 173、pending 0、distinct expert **5**、
created_at 範圍 2026-05-04 ~ **2026-08-14T02:44:45Z**。`updated_at` 欄位不存在（無法用它判斷改寫）。

| expert | slug | rows | published | last_published_at |
|---|---|---|---|---|
| 彥愷 | sharkgu | 85 | 85 | 2026-08-14T12:00:14Z |
| 老周老周 | master-zhou | 36 | 36 | 2026-08-15T00:00:11Z |
| brcto | master-brcto | 35 | 35 | 2026-08-14T12:00:10Z |
| Benny | benny | 14 | 14 | 2026-08-15T00:00:10Z |
| 阿基米德投資學 | master-lever | 3 | 3 | 2026-08-01T04:04:06Z |

其餘 8 位 expert 本來就 0 筆（sean / zhao-pengbo / mk / ele / laofoye / lin-xiuqi / vincent / master-brian）。

內容欄位空值分佈（DB 端，未經閘門）：`reason_summary` 空 14/173、`reason_detail` 空 81/173、
`learning_points` 空 147/173。逐週 `max(length(reason_detail))` 由 2026-05 到 2026-08 皆在
16–182 之間、`max(learning_points)` 最高 594 — **沒有任何一週出現「集體歸零」的斷崖**，
排除批次清空或截斷事故。

`trade_records`：total **82**、`quantity=0` 或 NULL **0 筆**、`entry_price` NULL **0 筆**，
created_at 2026-05-04 ~ 2026-08-14。→ **DB 端股數與進場價完全正常**，
截圖的 0 股 / `-` 不可能來自這張表的內容。

分類判定：
- 列仍在但被 query/閘門遮蔽：**YES（本案）**
- 欄位被清空：**NO**（DB 端數值欄 0 空值）
- soft delete / archive / version 切換：**NO**（無 deleted_at 欄位、無 status 變動，全部 published）
- 實體 DELETE：**NO**（總筆數與各老師筆數與歷史一致，最新一筆 2026-08-14/15 正常）

Sanitized manifest（不含任何老師原文，只有 ID / 老師 / 週次 / 長度 / md5 / 時間）：
- `.scratch/p0-journal-incident/expert_signals_manifest.csv` — 173 列
  sha256 `6b8ac96ee00c3858bc4b439634c251c5ac9d995cbe562e10dbd036fe1f285a89`
- `.scratch/p0-journal-incident/trade_records_manifest.csv` — 82 列
  sha256 `b261dba4884fd7cfe6b3fbcf09b6276e99930da643d0ab2b7f351a91a1883cc3`

## 3. 導致「全部消失」的 exact 變更

全部在 **2026-08-17（昨天）** 的 R1-P consumer closure 系列 commit，非 DB 變更、非 migration、非 RLS：

| commit | UTC | 內容 |
|---|---|---|
| `cf0a24525` | 2026-08-17 03:51:41 | 新增 `src/contracts/publicProjection.ts`（fail-closed 契約） |
| `f041e0fc2` | 2026-08-17 03:52:10 | 新增 `src/hooks/useProjectionStatus.ts` |
| `2bb098b8a` | 2026-08-17 04:00:54 | **把 `gatePositionRows` 接進 `useExpertHoldingsBundle`** ← 持股 0 股／`-` 的直接來源 |
| `19e529ed4` | 2026-08-17 04:24:57 | 新增 `src/lib/fetchProjectionStatus.ts`（列表用） |
| `555fe8d74` / `73ae7a60b` / `d9b70b5e6` | 2026-08-17 04:24–06:13 | 擴散到 journalRepository / Journals / performance 等消費端 |

觸發條件：`public.public_expert_state_active` 從未建立（查 `information_schema.tables`
→ 0 列）。契約 L133-141 明言「絕不回退到 legacy 數字路徑」，所以在 view 缺席的
production，**每一位 expert、每一週、每一個 tenant 都必然 fail-closed**，
與老師身分、RLS、時區、week filter 無關。這也解釋為何是「全部」而不是部分。

## 4. 可回復來源盤點（本案不需要，仍列出）

| 來源 | as-of | rows | 唯一老師 | 週數 | 說明 |
|---|---|---|---|---|---|
| production `expert_signals` | 2026-08-18T02:35Z | 173 | 5 | 15 週（2026-W19~W33） | **權威來源，完好** |
| production `trade_records` | 同上 | 82 | 5 | — | 完好，0 空值 |
| `gen:journal-export-mirror` / `check:journal-export-mirror` | — | — | — | — | 只是 `journalExportCore` 的**程式碼鏡像產生器**，不含任何老師內容 artifact，非備份來源 |
| Supabase PITR / backup | 未讀取 | — | — | — | 不需要；如需仍可申請 |

因權威表未受損，**不建立 recovery/merge 流程，也不會有覆寫既有內容的風險**。

## 5. 最小修方向（尚未執行，等你核准）

三選一，皆為前端／契約層，不動任何資料：

- **A（建議、最小）**：`useProjectionStatus` / `fetchProjectionStatus` 對
  「relation 不存在（42P01 / PGRST205）」回傳 `ready` 而非 fail-closed，
  只有 view 真的存在而狀態 not-ready 時才遮蔽。1 檔 2 處常數改動。
- **B**：把閘門限縮在公開面（訂閱者／匿名），老師自己的後台（`/admin/*`）與
  管理端一律 bypass — 作者看自己的資料本來就不該被公開投影遮蔽。
- **C**：建立 `public.public_expert_state_active` view 並回填 `ready`（需 migration，違反本輪唯讀約束）。

## 6. 尚缺的證據

- 使用者截圖對應的 exact 路由與登入身分尚未確認（SOXL/ORCL/AMD/QCOM/SpaceX 為美股標的，
  推測是 `sharkgu` 或 US 帳號的 `/admin/:slug/signals` 或績效頁）。
- 尚未在瀏覽器實測復現（需登入 session），修正後回歸時補。
</content>
</invoke>
