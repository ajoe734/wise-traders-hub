# PLAN_V4.4_E2E_EVIDENCE

僅補 SECOND_SOURCE_REVIEW 的 S1（390px 斷言缺口）與 S2（route counter vacuous）。
**只改 1 檔**：`e2e/holdings-bsr-unavailable.spec.ts`。不動 product / unit / config，不 deploy / Publish / DB / provider。

性質：**EVIDENCE_HARDENING**（coverage-only）。新斷言預期在現行產品碼直接綠，不冒充 pre-red product bug；不產生 TDD red receipt。

## 唯讀確認結果（本輪已驗）

| 項目 | 檔案:行 | 事實 |
|---|---|---|
| aria-label 組法 | `HoldingCard.tsx:127-130` | `` `…，報酬率 ${pctVal>=0?'+':''}${pctVal.toFixed(2)}%，損益 ${pnlVal>=0?'+':''}${pnlVal.toLocaleString()}。按 Enter…` `` → fixture(qty 1000/cost 100/price 110) 產出 exact 子字串 **`報酬率 +10.00%`**、**`損益 +10,000`**（全形逗號為 `，`，`+` 為半形，數字千分位 `,`） |
| 成本／現價文字 | `PriceTrack.tsx:47-48` | `成本 {c.toLocaleString(…)}` / `現價 {n.toLocaleString(…)}` → exact **`成本 100`**、**`現價 110`**（單一半形空格） |
| pnl 文字 | `HoldingCardReturn.tsx:60-66` | 正值 sign=`+`、`10.00` + `<span>%</span>`、`+10,000`；`card-pnl` 容器 `textContent` 串接後含 `+10.00%` 與 `10,000` |
| testids | `HoldingCard.tsx:245/260/273/285` | `card-qty`（標頭錨點，內含代號/名稱，**不含股數字面值** → 只作幾何錨點）、`card-pnl`、`card-price`、`card-bottom-row` 皆存在 |
| harness | `HoldingCardHarnessEntry.tsx` | `?code=` 模式渲染真實 HoldingCard；**無參數**時走 `decodeFixture()` 失敗分支只渲染錯誤字串、不發任何 chips/RPC 請求 → 可作 benign probe page |

## S2 — 具名 counter + 防 vacuous probe

1. 移除聚合 `lateCalls`，改兩個具名 counter：
   - `syncInvokeCalls: string[]` — handler 內 `new URL(req.url()).pathname === '/functions/v1/tw-institutional-daily-sync'` 才計入。
   - `backfillRpcCalls: string[]` — pathname `=== '/rest/v1/rpc/enqueue_bsr_backfill'` 才計入。
   - route pattern 用 glob `**/functions/v1/tw-institutional-daily-sync*` 與 `**/rest/v1/rpc/enqueue_bsr_backfill*`（跨 origin 皆可命中），一律 `route.fulfill({status:200, contentType:'application/json', body:'{}'})`，**不出網、不碰 provider**；其他 functions/rest 請求不安裝 route、不計入。
2. Probe（同一 page、同一 browser context，route 安裝後）：
   - `await page.goto('/e2e/holding-card-harness')`（無參數 benign 頁，不觸發 app 請求）。
   - `page.evaluate()` 內對兩個**同源相對路徑**各發一次 `fetch(path, { headers: { 'x-e2e-route-probe': '1' } })` → 同源、無 CORS。
   - 斷言 `syncInvokeCalls.length === 1 && backfillRpcCalls.length === 1`，且兩筆皆帶 `x-e2e-route-probe` header（handler 記錄 header 值）。
   - 斷言後 `length = 0` 歸零。
   - Fallback（僅在 evaluate 受限時採用，仍為同 browser-context route probe）：`page.request` 不可用（不經 page route），改以 harness 頁注入 `new Image()`／`navigator.sendBeacon` 等同 context 發送；**絕不**退化成 URL 字串比對或 source regex。
3. 再 `page.goto` terminal HoldingCard harness（`?code=%2000637l%20`），沿用既有等待窗（`data-bsr-state=unavailable_unsupported` → `watching=true` → 5s），最後斷言兩 counter **各 exact 0**。
4. 註明：probe 只證明 route matcher 非 vacuous；**行為權威證據仍是 runtime unit**（public hook terminal 0/0、transient 1/1）。

## S1 — 390×844 真實 HoldingCard 斷言

在既有 (b) 區塊補：
- `card-price` 需 `toContainText('成本 100')` 與 `toContainText('現價 110')`。
- `card-pnl` 需 `toContainText('10.00%')` 與 `toContainText('10,000')`（保留）。
- 卡片根節點 `page.locator('[data-holding-code]')` 的 `aria-label` 需含 `報酬率 +10.00%` 與 `損益 +10,000`。
- 對 `card-qty` / `card-price` / `card-pnl` / `holding-card-bsr` 四元素逐一斷言 `x>=0`、`y>=0`、`x+width<=390`、`y+height<=844`。
- `holding-card-bsr.y >= card-bottom-row.bottom - 1`（保留）。
- 明確註解 `card-qty` 僅幾何錨點，不算股數證據。
- viewport 需為 390×844（確認 project config；若 project 已是 390×844 則沿用，否則於測試內 `setViewportSize`，仍在同一檔內）。

## 不得弱化

保留 30+1 chunking（sizes `[30,1]`、31 unique）、raw ` 00637l ` → body `['00637L']`、no-drawer canonical unavailable、terminal 觀察窗。無 `.skip` / `.only`、無 `<=1` 類寬鬆 matcher。

## 執行與收尾

1. `npx playwright test --project=desktop-holdings-bsr-unavailable`
2. holdings/chips 7 named projects
3. journal/signal 7 named projects
4. `npx playwright test --list`（grep 確認無 skip/only）
5. `git diff --name-status e329dc33e6e7f79405b727ded362fa09dfca65cb..HEAD` — source 只能 1 檔；Lovable 自動 `.lovable/plan*` 與 `db/r1/p/acl-25.*` 分開列。
6. 重列 10 個 product/unit path 的 SHA256，與前輪比對；**若任一產品 source hash 改變 → 立即 REJECTED 並全部重跑**。
7. 不再跑 two-pass full vitest（產品 source 未變、前輪已連續兩次全綠）。
8. 停在 **THIRD_SOURCE_REVIEW_READY**，不 deploy。

## Allowlist

`e2e/holdings-bsr-unavailable.spec.ts` — 恰 1 檔。出現第 2 檔需求即停住回 BLOCKED。

## Open questions

無。
