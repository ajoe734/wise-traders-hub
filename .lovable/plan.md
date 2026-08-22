# Stage D — 持倉看板 BSR 顯示修復（Plan revision v2，唯讀證據已補；不實作）

禁令沿用：本輪 0 檔改動、0 deploy、0 Publish、0 DB/provider 呼叫。以下所有規則皆為本輪重讀原始碼／唯讀 SQL 取得。

## 0. 代號合法性 — 補證據（更正上一版把 00878 當 invalid 的錯誤）

exact 規則（三處，唯讀證實）：

| 位置 | 規則 | 用途 |
|---|---|---|
| `src/checkup/lib/chipsRepository.ts:275` `isTaiwanStockCode` | `/^\d{4,6}[A-Z]?$/`（trim，**大寫敏感**） | canonical「可送 batch 的台股代號」 |
| `src/checkup/lib/chipsRepository.ts:286` `isTaiwanChipEligible` | `/^[1-9]\d{3}$/` | 「有券商分點資料」的子集合，非合法性 |
| `supabase/functions/tw-chips-detail-v2/index.ts:531` `isValidId` | `/^[0-9A-Za-z]{3,10}$/` | edge 入口過濾（比前端寬） |
| `src/checkup/hooks/useChipsBatch.ts:18` `isValidCode` | `/^\d{4,6}[A-Z]?$/i` ← **重複實作**，且 `i` flag 與 canonical 不一致 | 要刪除 |

逐一裁定：

| 代號 | isTaiwanStockCode | isTaiwanChipEligible | edge isValidId | 結論 |
|---|---|---|---|---|
| 2330 | ✅ | ✅ | ✅ | 送批次、有 BSR |
| 0050 | ✅ | ❌（首位 0） | ✅ | **送批次**，BSR 段 `ineligible` |
| 00878 | ✅ | ❌ | ✅ | **送批次**，BSR 段 `ineligible`（合法 ETF，絕不可丟） |
| 006208 | ✅ | ❌ | ✅ | 同上 |
| 9105 | ✅ | ✅ | ✅ | TDR，送批次；BSR 由後端 eligibility 表決定 |
| 00637L | ✅（尾碼 L） | ❌ | ✅ | 送批次 |
| `''` / `ABC` / `2330<script>` / `2330,2317` | ❌ | ❌ | `ABC` 在 edge 反而 ✅ | 前端擋掉 |

唯讀 universe 佐證（production）：`chips_prefetch_targets` 20 列含 `00637L / 039108 / 053848 / 702157`；`tw_bsr_sync_queue` 內非四碼代號 40+ 例（`020020`、`030135`…）。**持倉 universe 確實含 5/6 位標的**，任何以「四碼」為過濾條件的 batch 都會漏。

**D2 過濾契約（修正）**：`useChipsBatch` 刪掉自有 `isValidCode`，一律 import canonical `isTaiwanStockCode`。通過者全部送批次（含 ETF/TDR）。**不靜默丟棄**：未通過 canonical 的代號進入 `unsupportedCodes`，卡片顯示 `ineligible`（不適用），並發 `chips_batch_code_rejected` telemetry。BSR 有無資料由 server `bsr_provider_state` 決定，前端不預判。

測試 fixture 修正：valid = `2330 / 0050 / 00878 / 006208 / 9105 / 00637L`；invalid = `''`、`'   '`、`ABC`、`2330 OR 1=1`、`<script>`、`2330,2317`、`00878x`。

## 1. UI 文案（鎖定）

canonical 主文案：**「籌碼資料暫時無法取得」**。可附加 `· 顯示最後可得資料 YYYY/MM/DD`（僅在有 `bsr_as_of` 時）。
**禁止**出現：provider 名稱、方案/level、HTTP 狀態碼、內部 code（`provider_plan_rejected`、`bsr_provider_unsupported`）、「此股票不支援」「上游來源中止」等會被讀成標的永久不支援的字樣。
機器可讀 state 仍為 `unavailable_unsupported`（放 `data-*`，不顯示給使用者）。
`ineligible`（ETF／權證）維持既有「不適用（ETF／權證／受益憑證）」，語意不同不可合併。

## 2. 單一 reactive data flow（取代含糊的 failedCodes）

新增獨立 query key，**不把假 payload 塞進 `['tw-chips', code]`**：

```ts
// src/checkup/hooks/useChipsBatch.ts
export const chipsBatchStatusKey = (code: string) =>
  ['tw-chips-batch-status', code] as const;

export type ChipsBatchStatus =
  | { kind: 'pending';  at: number }                       // 已納入本批、尚未回應
  | { kind: 'ok';       at: number }                       // 成功，資料在 ['tw-chips', code]
  | { kind: 'error';    at: number; reason: 'chunk_failed' | 'per_code_error' }
  | { kind: 'unsupported'; at: number };                   // 未通過 canonical validator
```

流程（唯一寫入者為 `useChipsBatch`）：
1. 送批前：對每個 valid code `qc.setQueryData(chipsBatchStatusKey(c), {kind:'pending'})`；unsupported code 寫 `{kind:'unsupported'}`。
2. chunk resolve：`res.results` 逐 code 寫 `['tw-chips', code]`（維持現有 `ChipsFetchResult` 形狀）+ status `ok`；`res.errors` 內的 code 寫 status `error/per_code_error`。
3. chunk reject（整批失敗）：只把**該 chunk** 的 code 寫 `error/chunk_failed`；其他 chunk 的 `ok` 一律保留（`Promise.allSettled`）。
4. 清除：下一輪 batch（codes key 改變或手動 retry）在步驟 1 重新寫 `pending`，即覆蓋舊 error；drawer 內 `useTwChipsDetail` 成功 refetch 時也會由 batch status 的 `ok`/`pending` 蓋掉——為避免雙寫，drawer 不寫 batch status，卡片以「`['tw-chips',code]` 有 data 就優先視為 available」解讀。

`HoldingCard` 解讀優先序（純函式 `resolveCardBsrState(chipsData, batchStatus)`，放 canonical mapper）：

```
data 存在 → mapProviderState(payload)  → 'available' | 'unavailable_unsupported' | 'ineligible' | 'degraded' | 'syncing'
data 不存在 + status.kind==='error'    → 'partial_error'
data 不存在 + status.kind==='unsupported' → 'ineligible'
其餘（pending / 無 status）            → 'loading'
```

## 3. Query observer 方案（版本已驗證）

- `package.json` `@tanstack/react-query: ^5.83.0`，`node_modules` 實裝 **5.83.0**。
- v5 的 `useQuery` 無論 `enabled` 為何都會建立 observer 並訂閱該 queryKey 的 cache entry；`enabled:false` 只擋自動 fetch，`setQueryData` 仍會觸發 re-render。這與現有 `useTwChipsDetail`（`useQuery({queryKey: chipsQueryKey(code), enabled: valid && online, staleTime: Infinity})`，`useTwChipsDetail.ts:74/112`）行為一致。
- 卡片**不重用** `useTwChipsDetail`（它帶 stamp 輪詢、auto-refresh、telemetry，會製造 N 個輪詢器）。改用兩個最小 observer：

```ts
const { data } = useQuery<ChipsFetchResult>({
  queryKey: chipsQueryKey(code), enabled: false,
  staleTime: Infinity, gcTime: 30*60*1000, notifyOnChangeProps: ['data'],
});
const { data: batchStatus } = useQuery<ChipsBatchStatus>({
  queryKey: chipsBatchStatusKey(code), enabled: false,
  staleTime: Infinity, notifyOnChangeProps: ['data'],
});
```

無 `queryFn` + `enabled:false` 在 v5 合法（不會 fetch、不會報 missing queryFn），型別由泛型給定。單測會直接斷言「setQueryData 後卡片 re-render 且 0 network」。

## 4. canonical mapper（單一真相）

新增 `src/checkup/lib/bsrCanonicalCodes.ts`（純函式、零依賴）：

```ts
export type BsrUiState =
  | 'available' | 'syncing' | 'degraded'
  | 'unavailable_unsupported' | 'ineligible' | 'partial_error' | 'loading';

export const BSR_UNAVAILABLE_TEXT = '籌碼資料暫時無法取得';
export const BSR_UNAVAILABLE_WITH_ASOF = (asOf: string) =>
  `${BSR_UNAVAILABLE_TEXT} · 顯示最後可得資料 ${asOf}`;

export function mapProviderState(p: {
  providerState?: string | null; providerCode?: string | null; bsrAsOf?: string | null;
}): BsrUiState;
export function isTerminalUnavailable(p): boolean;   // ← D4 唯一判斷來源
export function resolveCardBsrState(chipsData, batchStatus): BsrUiState;
```

`isTerminalUnavailable` 由 `chipsBackfillMachine`、`ChipsSection` 手動按鈕、`HoldingCard`、drawer segments **共用**，四處皆不再自行比對字串（現況 `ChipsSection.tsx:193` 自比 `'terminal_provider_rejected'`，將改為呼叫 mapper）。

## 5. changed-files allowlist — exact 10 檔（產品 7 / 測試 3 modify + 2 new）

**產品碼（7 檔）**
1. `src/checkup/lib/bsrCanonicalCodes.ts` — **新增**。§4 的常數、`mapProviderState`、`isTerminalUnavailable`、`resolveCardBsrState`、canonical 文案。
2. `src/checkup/hooks/useChipsBatch.ts` — 刪 `isValidCode`/`.slice(0,30)`；改用 `isTaiwanStockCode`；`chunk(codes,30)` + `Promise.allSettled`；新增並匯出 `chipsBatchStatusKey` / `ChipsBatchStatus` 寫入邏輯；unsupported telemetry。
3. `src/checkup/lib/chipsRepository.ts` — `fetchChipsBatch` 移除 L468 `.slice(CHIPS_BATCH_MAX_STOCKS)`，改為 `ids.length > 30` 時 `throw new Error('chips_batch_over_limit')`；`normalizeStockCodes` 不變；常數不變。
4. `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardBsr.tsx` — **新增**。兩個 observer + mapper，輸出 `data-testid="holding-card-bsr"`、`data-bsr-state`、`data-bsr-as-of`；文案用 §1。
5. `src/checkup/components/freecheckup/HoldingCard.tsx` — 只在 `HoldingCardFooter` 之後掛 `<HoldingCardBsr code={h.code} />`，不動既有四層與 class hook。
6. `src/checkup/components/freecheckup/chipsFreshnessSegments.ts` — `buildBsrSegment` terminal 分支改呼叫 mapper，state 一律 `unavailable_unsupported`，文案改 §1（移除「上游來源中止」字樣）；其餘分支不動。
7. `src/checkup/lib/chipsBackfillMachine.ts` + 呼叫端 `ChipsSection.tsx` 為兩件事，故拆為 7a/7b：
   - 7a `src/checkup/lib/chipsBackfillMachine.ts` — `ChipsBackfillSnapshot` 加 `terminalUnavailable: boolean`；`shouldAutoTrigger` 首行 `if (s.terminalUnavailable) return false;`。
   - 7b `src/checkup/components/freecheckup/ChipsSection.tsx` — 以 `isTerminalUnavailable()` 取代 L193 字串比對；把值傳進 `useChipsAutoBackfill`；terminal 時隱藏「回補 60 日」按鈕。
   （因此產品碼實際為 **8 個檔案路徑**：1,2,3,4,5,6,7a,7b。）

**edge（2 檔，本輪只寫 source，不 deploy）**
9. `supabase/functions/_shared/bsrProviderState.ts` — `classifyBsrError` 開頭新增：normalize 後 `/^provider_plan_rejected(:|\b)/` 命中 → `terminal_provider_rejected / provider_plan_rejected`（涵蓋 C1 除敏字串 `provider_plan_rejected:http_400`，現行 TERMINAL_SIGNATURES 比不到，唯讀驗證：normalize 結果為 `provider_plan_rejected http 400`，status=400 非 429/5xx → 落到 `unknown_degraded/unclassified`）。不動其他分支。
10. `supabase/functions/tw-chips-detail-v2/index.ts` — L233-244 已讀 `tw_bsr_sync_config where key='market_batch'` 的整個 `config` jsonb（**read path 已存在，不需新增查詢**），只把 L241-244 的 `startsWith('unsupported_plan:')` 換成讀 canonical v8 鍵：
   `marketBatchErrorClass = (marketBatch.admission_blocked === true && marketBatch.admission_terminal_code === 'bsr_provider_unsupported') ? 'provider_plan_rejected' : (舊 unsupported_plan 前綴保留為 fallback)`；同時 `marketBatchUnsupported` 加上 `|| admission_blocked === true`。raw 值仍不外流。

**測試（3 檔 modify）**：`src/test/unit/bsr-canonical-code-mapping.test.ts`、`src/test/unit/holdings-chips-chunking.test.ts`、`src/test/unit/holdings-nodrawer-chips-consumer.test.tsx`（fixture 依 §0 更新）；`e2e/holdings-bsr-unavailable.spec.ts` 斷言 `unavailable_unsupported` 與文案。

**0 changed files（硬性）**：`/admin/:slug/signals` 相關、`src/pages/admin/**`、`JournalDetail.tsx`、`journalRepository`、任何 DB migration、cron、RLS。

**Non-goals**：不重構 HoldingCard 四層、不改版面、不擴 payload schema、不新增儀表板/告警/PDF。

## 6. `bsr_terminal_code` schema 裁決 → **不擴**

`bsr_provider_state='terminal_provider_rejected'` + `bsr_provider_code='provider_plan_rejected'` 已可無歧義映射到 `unavailable_unsupported`：白名單中 `provider_plan_rejected` 是**唯一**會伴隨 terminal state 的 code（`BSR_PROVIDER_CODES` 其餘值分別綁 retryable/unknown/fresh/ineligible），無 collision。故 payload 不加 `bsr_terminal_code`；e2e fixture 若含該欄位視為多餘欄位，斷言改用 `bsr_provider_state/_code`。

## 7. 驗收拆分與 deployment gate

**A. Source + unit/integration（0 deploy，本階段可做）**
- `bunx vitest run` 全量綠；新增 chunk 邊界（1/30/31/60/61 + 重複 + `00878`/`006208` 保留 + 真非法值剔除）、partial chunk failure 保留成功 chunk、setQueryData → 卡片 re-render 且 fetch 次數 0、terminal → 0 次 `enqueue_bsr_backfill`。
- e2e（本機 dev server + `page.route` 攔截 mock response）：`npx playwright test --project=desktop-holdings-bsr-unavailable` 與 `desktop-chips-batch`，證明 31 檔 2 requests、卡片 `unavailable_unsupported`。
- 週記/訊號回歸：`journal-*`、`signal-*` 專案 smoke。
- 說明：A 只能證明「給定 D3 payload，UI 正確」；**不能**證明 production edge 真的回 terminal。

**B. Hosted Preview（需 edge deploy，目前為 blocker）**
- gate：`tw-chips-detail-v2` + `_shared/bsrProviderState.ts` deploy（**未獲授權，不執行**）。
- 內容：全新無痕、清 cache、完全不開 drawer，觀察真實 `POST /tw-chips-detail-v2` 請求數與回傳 `bsr_provider_state`，截圖 + HAR 留存。
- 在 B 完成前，D3 的「真實 response」驗收狀態明確標記為 **BLOCKED（待 edge deploy 授權）**，不得以 unit test 冒充。

## 8. Open questions

- 全數歸零，僅剩一個**明確 blocker**：edge deploy 未授權 → 驗收 B 無法執行，D3 只能在 source/unit 層完成。其餘（validator 規則、文案、schema 擴充、mapper 落點、changed-files）皆已裁定。

## 9. Remaining risk

admission gate 仍為 `admission_blocked=true`；本階段只讓 UI 誠實顯示「籌碼資料暫時無法取得 + 最後可得日期」，**不會**產生新的 BSR 資料，也不打任何 provider。背景新鮮度屬另案。
