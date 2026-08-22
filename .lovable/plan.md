# Stage D — 持倉看板 BSR 顯示修復（Plan v3，convergence；本輪 0 mutation）

沿用禁令：不改檔、不 deploy、不 Publish、不動 DB/cron/provider。以下規則全部來自本輪唯讀重讀。

---

## A. changed-files allowlist — exact 17 paths（每行一個）

**Frontend product（11）**
1. `new` `src/checkup/lib/bsrCanonicalCodes.ts`
2. `modify` `src/checkup/lib/chipsRepository.ts`
3. `modify` `src/checkup/hooks/useChipsBatch.ts`
4. `new` `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardBsr.tsx`
5. `modify` `src/checkup/components/freecheckup/HoldingCard.tsx`
6. `modify` `src/checkup/components/freecheckup/chipsFreshnessSegments.ts`
7. `modify` `src/checkup/lib/chipsBackfillMachine.ts`
8. `modify` `src/checkup/lib/chipsLifecycle.ts`
9. `modify` `src/checkup/hooks/useChipsAutoBackfill.ts`
10. `modify` `src/checkup/hooks/useChipsLifecycle.ts`
11. `modify` `src/checkup/components/freecheckup/ChipsSection.tsx`

**Edge（1）**
12. `modify` `supabase/functions/tw-chips-detail-v2/index.ts`

**Tests（5）**
13. `modify` `src/test/unit/bsr-canonical-code-mapping.test.ts`
14. `modify` `src/test/unit/holdings-chips-chunking.test.ts`
15. `modify` `src/test/unit/holdings-nodrawer-chips-consumer.test.tsx`
16. `new` `src/test/unit/holdings-chips-batch-race.test.ts`
17. `modify` `e2e/holdings-bsr-unavailable.spec.ts`

**明確排除**：`supabase/functions/_shared/bsrProviderState.ts`（理由見 F）、所有 migration/cron/RLS、`src/pages/admin/**`、`JournalDetail.tsx`、`journalRepository`。週記／`/admin/:slug/signals` 路徑 **0 changed files**。

---

## B. auto-backfill call chain（exact signatures，決定改哪一檔）

```text
ChipsSection.tsx:161-168
  const { ..., backfilling, backfillPhase, requestBackfill } = useChipsLifecycle(stockCode, true)

useChipsLifecycle.ts:55  export function useChipsLifecycle(stockCode: string, enabled = true): ChipsLifecycle
  L56  const detail = useTwChipsDetail(stockCode, enabled)
  L59  const facts = useMemo(() => deriveChipsFacts(data), [data])     // chipsLifecycle.ts:82
  L84  const { backfilling, requestBackfill } = useChipsBackfill(stockCode)
  L101 useChipsAutoBackfill({ stockCode, hasData, sparse: facts.sparse, eligible: facts.eligible,
                              syncStatus: facts.syncStatus, satisfied: facts.satisfied,
                              requestBackfill: handleBackfill, onTimeout })

useChipsAutoBackfill.ts:30  ({...}: UseChipsAutoBackfillInput) => { phase }
  L76  dispatch({type:'snapshot', snapshot:{stockCode,hasData,sparse,eligible,syncStatus,satisfied,now}})

chipsBackfillMachine.ts:86  shouldAutoTrigger(state, s: ChipsBackfillSnapshot): boolean
```

更正 v2 的錯誤敘述：**ChipsSection 不會、也不能直接餵值給 `useChipsAutoBackfill`**；它只拿 `useChipsLifecycle` 的回傳。terminal 事實必須沿 `payload → deriveChipsFacts → ChipsFacts → useChipsLifecycle → useChipsAutoBackfill → snapshot → shouldAutoTrigger` 這條既有管線穿透，因此 8/9/10 三個 hook/lib 檔**必須**在 allowlist（v2 漏列 `chipsLifecycle.ts` 與 `useChipsAutoBackfill.ts`，已補）。

逐檔最小變更：
- 8 `chipsLifecycle.ts`：`ChipsFacts` 加 `terminalUnavailable: boolean`；`deriveChipsFacts` 以 `isTerminalUnavailable({providerState: payload.bsr_provider_state ?? payload.bsr_sync_status?.provider_state, providerCode: payload.bsr_sync_status?.provider_code})` 計算；`EMPTY_CHIPS_FACTS` 補 `false`。
- 9 `useChipsAutoBackfill.ts`：`UseChipsAutoBackfillInput` 加 `terminalUnavailable: boolean`；帶進 snapshot 與 effect deps。
- 10 `useChipsLifecycle.ts`：`useChipsAutoBackfill({ ..., terminalUnavailable: facts.terminalUnavailable })`。介面 `ChipsLifecycle` 不變（`facts` 已對外，ChipsSection 直接讀 `facts.terminalUnavailable`）。
- 7 `chipsBackfillMachine.ts`：`ChipsBackfillSnapshot` 加同名欄位；`shouldAutoTrigger` 第一行 `if (s.terminalUnavailable) return false;`。
- 11 `ChipsSection.tsx`：L193 `providerState === 'terminal_provider_rejected'` 改為 `facts.terminalUnavailable`；L350 `sparse && !error` 的手動回補按鈕加 `&& !facts.terminalUnavailable`。

---

## C. cache type — 三處 exact 相同

- 寫入端 `useChipsBatch.ts:76`：`qc.setQueryData<ChipsFetchResult>(chipsQueryKey(code), { payload, stampVer, bytes: 0, durationMs: 0 }, { updatedAt: now })`
- 型別權威 `chipsRepository.ts:356`：
  ```ts
  export interface ChipsFetchResult { payload: TwChipsPayload; stampVer: string | null; bytes: number; durationMs: number; }
  ```
- 讀取端 `useTwChipsDetail.ts:112`：`useQuery<ChipsFetchResult, unknown>({ queryKey: chipsQueryKey(code), ... })`
- 卡片 observer 泛型：**同一個 `ChipsFetchResult`**，`data?.payload` 為 `TwChipsPayload`。卡片不建立、也不寫入任何假 payload；`['tw-chips', code]` 只由 batch 成功回應與 `useTwChipsDetail` 寫入。

batch 狀態走**另一把 key**：
```ts
// useChipsBatch.ts（新增 export）
export const chipsBatchStatusKey = (code: string) => ['tw-chips-batch-status', code] as const;
export interface ChipsBatchStatus {
  kind: 'pending' | 'ok' | 'error' | 'not_applicable';
  // 'not_applicable' = 未通過台股 batch canonical validator（例：美股代號 ABC/ORCL/AMD、空字串、非法字元）。
  // 語意為「本地不送 batch」，**不等於** payload 的 providerState='ineligible'（ETF／權證／受益憑證）。
  runId: number;              // 見 D
  at: number;
  reason?: 'chunk_failed' | 'per_code_error';
}
```

---

## D. 優先序契約與 race 防護

`resolveCardBsrState(chipsData?: ChipsFetchResult, status?: ChipsBatchStatus): BsrUiState`，判斷序（由上而下，先命中先返回）：

1. `payload` 存在且 canonical 判為 `unavailable_unsupported` 或 `ineligible` → **回該權威狀態**（terminal/ineligible 不被 batch error 蓋掉）。
2. `status.kind === 'error'` → `partial_error`（**即使有 stale payload**；資料保留、顯示最後可得日期，但不得標 available）。
3. `status.kind === 'not_applicable'` → `not_applicable`（**不得**映射成 `ineligible`）。`ineligible` 只能由真實 payload `providerState === 'ineligible'` 產生（第 1 條）。
4. `status.kind === 'ok'` 且 payload 存在 → `mapProviderState(payload)`（`available` / `syncing` / `degraded` / …）。
5. `status.kind === 'pending'` 且 payload 存在 → `syncing`（顯示 last-known as-of，不閃回 loading）。
6. 其餘 → `loading`。

**Race（current-run identity）**
- `useChipsBatch` 內 `const runIdRef = useRef(0)`；每次 codes key 變更或手動 retry `runIdRef.current += 1`，該值即 `runId`。
- **不做併發 retry**：既有 effect cleanup 已 `ac.abort()` + `cancelled = true`；v3 再加硬閘 —— 每個 chunk 的 `.then/.catch` 進入寫入前先檢查 `myRun === runIdRef.current`，不符即整批丟棄（不 setQueryData）。
- 寫入的 `ChipsBatchStatus.runId` 亦帶 `myRun`；`resolveCardBsrState` 只信任 store 內最新一筆（TanStack 單筆覆寫，天然最新），舊 run 因上一條硬閘根本不會寫入。
- 結論：舊 chunk 晚回覆 **不可能** 覆蓋新 run 的 `pending/ok/error`，且不需要並行 run 管理器。

**清除 error**：新 run 步驟 1 對所有本輪 valid code 寫 `{kind:'pending', runId}`，即覆蓋前一輪 error。

---

## E. 代號 normalization 與 fixture

- 現況：`chipsRepository.ts:446` `function normalizeStockCodes()`（**未 export**，只 `trim`，無 uppercase）；`isTaiwanStockCode` 為 `/^\d{4,6}[A-Z]?$/`（大寫敏感）；`useChipsBatch.ts:18` 另有 `/^\d{4,6}[A-Z]?$/i`。→ `00637l` 現在會通過 hook 但被 repository 的 filter 丟掉，屬**靜默漏檔**。
- v3 修法（檔 2 的最小變更）：新增並 export
  ```ts
  export function normalizeStockCode(code: unknown): string { return String(code ?? '').trim().toUpperCase(); }
  ```
  `normalizeStockCodes()` 改用它；`useChipsBatch` 刪除自有 `isValidCode`，改 `normalizeStockCode` → `isTaiwanStockCode` → dedupe（Set）。兩端規則自此完全一致。
- **不新增任何 telemetry**（v2 的 `chips_batch_code_rejected` 移出 scope）。未通過 canonical 的代號只寫本地 observable `{kind:'not_applicable'}`，不打 API、不記事件。
- fixture：
  - valid（台股 canonical）：`2330`、`0050`、`00878`、`006208`、`9105`、`00637L`、`00637l`（normalize 後等同前者，須被 dedupe 合併）
  - not_applicable（合法但非台股 batch universe）：`ABC`、`ORCL`、`AMD` → 不打 batch、卡片顯示「籌碼資料不適用」、**不得**顯示 ETF／權證文案、quantity/value/ROI 完全不受影響。
  - invalid（非法輸入，同樣落 `not_applicable`）：`''`、`'   '`、`'<script>alert(1)</script>'`、`'2330,2317'`、`"2330' OR '1'='1"`
  - `00878x` 已從 fixture 刪除（不做武斷判定）。

---

## F. edge gate — 只改 1 檔（檔 12），`_shared/bsrProviderState.ts` 不改

`tw-chips-detail-v2/index.ts:232-244` 已 `select config from tw_bsr_sync_config where key='market_batch'`，**整個 jsonb 都在手上，read path 無需新增**。改法：

```ts
const terminalGate =
  marketBatch?.admission_blocked === true &&
  String(marketBatch?.admission_terminal_code ?? '') === 'bsr_provider_unsupported' &&
  String(marketBatch?.admission_reason ?? '') === 'provider_plan_rejected';

// legacy fallback 原樣保留
const legacyUnsupported = marketBatch?.supported === false &&
  String(marketBatch?.last_probe_outcome ?? '') === 'unsupported';
const legacyPrefixHit = legacyUnsupported &&
  String(marketBatch?.last_probe_error ?? '').startsWith('unsupported_plan:');

const marketBatchUnsupported = terminalGate || legacyUnsupported;   // 不是 ||= admission_blocked
const marketBatchErrorClass = (terminalGate || legacyPrefixHit) ? 'provider_plan_rejected' : null;
```

**為何 `_shared/bsrProviderState.ts` 不必改**：`classifyBsrError` 的第一分支即
`if (persistedErrorClass && TERMINAL_ERROR_CLASSES.has(persistedErrorClass)) → terminal_provider_rejected / provider_plan_rejected`（`bsrProviderState.ts:104-106`）。只要 index 傳入 `persistedErrorClass='provider_plan_rejected'` 就必定走 terminal，**不需要**再新增字串前綴規則；新增反而會製造第二套分類分叉。故從 allowlist 移除。
（唯讀佐證：C1 除敏字串 `provider_plan_rejected:http_400` normalize 後為 `provider_plan_rejected http 400`，不命中 TERMINAL_SIGNATURES、status=400 → 現況落 `unknown_degraded/unclassified`；terminalGate 修好後這條路徑不再被依賴。）

payload schema **不擴**：`bsr_provider_state='terminal_provider_rejected'` + `bsr_provider_code='provider_plan_rejected'` 已無歧義（`BSR_PROVIDER_CODES` 其餘值皆不與 terminal state 併存），不加 `bsr_terminal_code`。

---

## G. 文案與 UI 落點

canonical 常數（檔 1）：

| state | exact visible text |
|---|---|
| `unavailable_unsupported`（無 as-of） | `籌碼資料暫時無法取得` |
| `unavailable_unsupported`（有 as-of） | `籌碼資料暫時無法取得 · 顯示最後可得資料 2026/08/14` |
| `partial_error`（無 as-of） | `籌碼資料暫時無法取得` |
| `partial_error`（有 as-of） | `籌碼資料暫時無法取得 · 顯示最後可得資料 2026/08/14` |
| `syncing` | `籌碼資料更新中` |
| `ineligible`（**僅** payload providerState=ineligible） | `不適用（ETF／權證／受益憑證）` |
| `not_applicable`（本地未通過台股 canonical validator，如美股代號） | `籌碼資料不適用` |
| `available` / `loading` | 不顯示任何文字 |

禁止出現：provider 名稱、方案/level、HTTP 狀態碼、內部 code、「此股票不支援」「上游來源中止」。

**卡片落點（不新增版面列）**：`HoldingCard.tsx` 是 `display:flex; flex-direction:column` 的固定 `minHeight` 卡殼，四層之後接 `{SyncOverlay}{SyncErrorStrip}{SyncSrStatus}` 三個 **absolute / sr-only** 節點（L285-287）。`HoldingCardBsr` 沿用**同一個既有狀態槽模式**：
- `available` / `loading`：只輸出 1×1 sr-only span（帶 `data-testid="holding-card-bsr"`、`data-bsr-state`、`data-bsr-as-of`），**零版面影響**。
- 其他狀態：`position:absolute; left:0; right:0; bottom:0`、`fontSize:10`、muted 底色的一行 strip（與 `SyncErrorStrip` 同機制、`zIndex:3` 低一級）；`cardSyncError` 存在時只保留 sr-only 節點，避免兩條 strip 疊字。
- 不改 `wb-card` / `wb-bottom` 等 class hook、不改 `MIN_H`、不進 grid 流 → 320/375/390/560 各斷點與既有視覺快照不受影響。
- **絕不觸碰** quantity / value / status / ROI 欄位：`HoldingCardBsr` 不接收 `h.qty`、不 render 數字、不提供任何 0 fallback；BSR 狀態與持倉數字完全解耦。

---

## H. 驗收

**A 階段（0 deploy，可立即執行）**
- `tsgo`（TS-only typecheck）、`bunx eslint`（含 `npm run check:module-boundaries`）、`bunx vite build`。
- `bunx vitest run` 全量；新增／更新案例：
  - chunking：1 / 30 / 31 / 60 / 61 → 1 / 1 / 2 / 2 / 3 requests；union 完整、單批 ≤30、無跨批覆蓋。
  - normalization：`00637l` 與 `00637L` dedupe 為 1；E 的 invalid 清單全部落 `unsupported`。
  - partial failure：chunk#2 reject → chunk#1 的 `['tw-chips',code]` 保留、狀態 `ok`；chunk#2 的 code 為 `error/chunk_failed`。
  - 優先序：terminal payload + `error` 狀態 → 仍 `unavailable_unsupported`；stale payload + `error` → `partial_error`（含 as-of，且非 available）；stale payload + `pending` → `syncing`。
  - race（檔 16）：run1 送出未回 → codes 變更觸發 run2 → run1 晚回覆，斷言 0 次寫入且卡片維持 run2 的 `pending/ok`。
  - 不開 drawer：`setQueryData` 後卡片 re-render，且 `fetch` 呼叫數 0。
  - terminal → `enqueue_bsr_backfill` / `tw-institutional-daily-sync` 呼叫數 0；`retryable`/`sparse` 仍照舊觸發。
- Playwright（**exact 既有 project 名稱**，dev server + `page.route` mock）：
  - `npx playwright test --project=desktop-holdings-bsr-unavailable`
  - `npx playwright test --project=desktop-chips-batch`
  - `npx playwright test --project=desktop-chips-section --project=mobile-chips-section --project=desktop-chips-freshness-segments --project=visual-chips-section`
  - 週記／訊號回歸（唯讀自 `playwright.config.ts` 取得，非杜撰 glob）：`desktop-journal-detail-title-collapse`、`desktop-journal-detail-owner-preview`、`desktop-journal-detail-owner-preview-brcto`、`desktop-journal-detail-admin-preview`、`desktop-signal-detail-preview-currency-schema`、`desktop-signal-detail-incomplete-teaching-fields`。
  - **誠實前提**：上述 journal/signal project 若在本環境需要登入 fixture 而無法取得 session，我會照實回報「無法執行」，改以 (a) `git diff --name-only` 對 allowlist 的 static changed-path guard（證明週記路徑 0 檔異動）＋ (b) 可跑的 holdings/chips smoke 代替，**不會宣稱通過**。

**B 階段（hosted Preview，deployment gate）**
- gate：`supabase/functions/tw-chips-detail-v2` deploy 授權（**目前未授權**）。
- 內容：全新無痕 + 清 cache + 完全不開 drawer，記錄真實 `POST /tw-chips-detail-v2` 請求數與 `bsr_provider_state`，留存截圖 / HAR。
- 在 B 完成前，D3 的「真實 response」標記為 **BLOCKED**，不以 unit test 冒充。

---

## Open questions

只剩一項，且是 deploy gate：**`tw-chips-detail-v2` 的 edge deploy 未授權**，故驗收 B 無法執行。其餘全部已裁定（allowlist、call chain、cache type、優先序與 race、normalization、edge gate、文案與版面、測試命令）。

## Remaining risk

`admission_blocked=true` 仍成立；本階段只讓 UI 誠實顯示「籌碼資料暫時無法取得（＋最後可得日期）」，不會產生新 BSR 資料，也不打任何 provider。背景新鮮度屬另案。
