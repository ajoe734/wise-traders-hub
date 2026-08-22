# Stage D — 持倉看板 BSR 顯示四項修復（Plan only／唯讀稽核完成）

只做 DB→UI mapping 與卡片層消費，不碰 provider、不碰 cron/queue/DB 資料。C2 不開。

## A. 現況 call graph（exact，全部本輪重讀，不引用舊摘要）

```text
HoldingsWorkbench.tsx
  L91  sparklineCodes = orderedDisplayed.map(h => h.code)      // 可見卡片全集，可 >30
  L105 useChipsBatch({ codes: sparklineCodes, enabled: !isDemo })  // 只取回 prefetch
  L261 <HoldingCard ... onPrefetch={prefetch} />               // 沒有任何 chips prop

useChipsBatch.ts
  L57  validCodes = dedupeCodes(codes).slice(0, 30)   ← D2 截斷點①
  L58  key = validCodes.sort().join(',')
  L67  useEffect → fetchChipsBatch(validCodes)  （單一請求，無 chunk）
  L76  qc.setQueryData(chipsQueryKey(code), {payload,...})  ← 只寫，無 render consumer
  L80  setPrefetched(new Set(...))  // 內部 state，未外流

chipsRepository.ts
  L292 CHIPS_BATCH_MAX_STOCKS = 30
  L466 ids = normalize→isTaiwanStockCode→.slice(0, CHIPS_BATCH_MAX_STOCKS) ← 截斷點②
  L476 POST /tw-chips-detail-v2  body { stock_ids }
  回傳 { results, errors, count, failed, servedAt }

tw-chips-detail-v2/index.ts
  L29  MAX_BATCH = 30；L563 slice(0,30)；L570 duplicate stock_ids → 400
  L236 marketBatchUnsupported = config.supported===false && last_probe_outcome==='unsupported'
  L243 marketBatchErrorClass = last_probe_error.startsWith('unsupported_plan:') ? 'provider_plan_rejected' : null
  L307 classifyBsrProvider({ lastErrorRaw: marketBatchError, persistedErrorClass: marketBatchErrorClass ?? topFail.error_class })
  L329/L461 → bsr_sync_status.provider_state / bsr_provider_state

前端消費者（唯一）：HoldingsDetailPanel → ChipsSection.tsx
  L167 useChipsLifecycle → useTwChipsDetail(chipsQueryKey) + useChipsBackfill + useChipsAutoBackfill
  L191 providerState = data.bsr_provider_state ?? sync_status.provider_state
  L326 buildFreshnessSegments(data) → data-seg-state
```

query key：`chipsQueryKey(code) = ['tw-chips', code]`（useTwChipsDetail.ts L74）。
batch 寫入與 drawer 讀取共用同一把 key，所以「卡片訂閱同一把 key」是最小改法。

## B. 四個根因（逐點，附行號）

- **D1**：`HoldingCard.tsx`（302 行）與 `_ui/holdingCard/*` 完全沒有 `chipsQueryKey` / `useTwChipsDetail` / `holding-card-bsr` 節點。`useChipsBatch` 寫進 cache 後**沒有任何 render 端訂閱**，所以不開抽屜永遠看不到狀態變化。
- **D2**：兩處硬截斷（`useChipsBatch.ts` L57、`chipsRepository.ts` L466）。31 檔 → 1 request、第 31 檔永遠無資料，且完全靜默（無 telemetry 標示被丟棄）。edge 端 `MAX_BATCH=30` 是正確的每批上限，chunk 責任在前端。
- **D3（雙層）**：
  1. **server 端誤分類**：production `market_batch.last_probe_error` 已於 C1 除敏為 `provider_plan_rejected:http_400`，但 v2 L243 只認 `unsupported_plan:` 前綴 → `marketBatchErrorClass=null`；per-stock 佐證也沒有（唯讀查核：`tw_bsr_fetch_failures` 5417 列 `error_class` **全為 NULL**）。`classifyBsrError` 的 TERMINAL_SIGNATURES 也比不到該字串 → 目前回的是 **`unknown_degraded`**，UI 顯示「上游狀態待確認」而非誠實的「不支援」。這是 D3 的主因。
  2. **前端無此 seg state**：`chipsFreshnessSegments.ts` L77-84 terminal 只產 `terminal_stale` / `terminal_no_data`，沒有 `unavailable_unsupported`；`bsrHeaderLabel.ts` L50 另有一組字面字串。canonical 模組 `@/checkup/lib/bsrCanonicalCodes` **不存在**。
- **D4**：`chipsBackfillMachine.ts` `shouldAutoTrigger`（L86-98）只看 `sparse / eligible / syncStatus`，**沒有 provider terminal 判斷** → terminal 股票開抽屜仍會 `requestBackfill()`（`useChipsBackfill` 打 `tw-institutional-daily-sync` + `enqueue_bsr_backfill` RPC，每檔每 session 2 次預算）。`ChipsSection.tsx` L350 手動「回補 60 日」按鈕也只由 `sparse` 控制。前端已無 `ensure_bsr_queued` 呼叫（P3 已移除，僅註解殘留）。

## C. status/code mapping 現況與 canonical 落點

| 層 | 現況位置 | 值 |
|---|---|---|
| DB gate | `tw_bsr_sync_config.market_batch` v8 | `admission_terminal_code=bsr_provider_unsupported`、`admission_reason=provider_plan_rejected` |
| edge classifier | `_shared/bsrProviderState.ts` | `terminal_provider_rejected` / code `provider_plan_rejected` |
| payload | v2 L329/L461 | `bsr_provider_state`、`bsr_provider_code` |
| drawer seg | `chipsFreshnessSegments.ts` | `terminal_stale` / `terminal_no_data`（不合契約） |
| drawer header | `bsrHeaderLabel.ts` L50 | 另一組字面字串 |
| 卡片 | 無 | — |

**canonical 單一落點：新增 `src/checkup/lib/bsrCanonicalCodes.ts`**（純常數 + `mapProviderState()`，零依賴），由 segments / headerLabel / 卡片 / 抽屜共同 import。edge 側維持 `_shared/bsrProviderState.ts` 為權威分類器，只補「認得 DB canonical code 與除敏後字串」。

## D. changed-files allowlist

**產品碼（6 檔）**
1. `src/checkup/lib/bsrCanonicalCodes.ts`（新增）— 四段常數 + `mapProviderState`。
2. `src/checkup/hooks/useChipsBatch.ts` — 去重後 `chunk(30)`、`Promise.allSettled` 併發、逐 chunk 寫 cache、移除 `slice(0,30)`；回傳 `{prefetch, prefetched, failedCodes}`。
3. `src/checkup/lib/chipsRepository.ts` — 移除 L466 的 `.slice()`，改為 >30 直接丟明確 error（呼叫端負責 chunk），常數保留。
4. `src/checkup/components/freecheckup/chipsFreshnessSegments.ts` — terminal 分支輸出 `unavailable_unsupported`，文案含「不支援」+ 最後可得日期。
5. `src/checkup/components/freecheckup/HoldingCard.tsx`（或新 `_ui/holdingCard/HoldingCardBsr.tsx`）— 以 `useQuery(chipsQueryKey)` 純訂閱（`enabled:false`，不自行發請求），渲染 `data-testid="holding-card-bsr"` / `data-bsr-state` / `data-bsr-as-of`。
6. `src/checkup/lib/chipsBackfillMachine.ts` + `src/checkup/components/freecheckup/ChipsSection.tsx` — terminal 時 `shouldAutoTrigger=false`、隱藏手動回補按鈕；其他狀態行為不變。

**edge（1 檔，本階段只寫 code 不 deploy）**
7. `supabase/functions/tw-chips-detail-v2/index.ts` + `_shared/bsrProviderState.ts` — 讓 `admission_blocked=true && admission_terminal_code='bsr_provider_unsupported'` 直接判 terminal（不再依賴字串前綴比對）。

**測試（分開）**：`src/test/unit/{bsr-canonical-code-mapping,holdings-chips-chunking,holdings-nodrawer-chips-consumer}.test.ts(x)` 轉 GREEN；新增 chunk 邊界與 terminal-no-enqueue 單測；`e2e/holdings-bsr-unavailable.spec.ts` 轉 GREEN。

**Non-goals**：不重構 HoldingCard 四層結構、不動 ChipsSection 版面、不改 queue/cron/RPC/RLS、不改 quantity/value 計算、不動 `/admin/:slug/signals` 與週記路徑、不新增儀表板或告警。

## E. 測試矩陣

1. 不開 drawer：batch 回應到達後卡片自動由 loading → available / `unavailable_unsupported`。
2. chunking：1／30／31／60／61 檔 → 1/1/2/2/3 requests；含重複與非法 ID（`ABC`、空字串、`00878`）→ 去重後計數正確、union 完整、單批 ≤30、無跨批覆蓋。
3. 部分失敗：chunk#2 reject → chunk#1 結果保留在 cache，失敗代號標 partial/error，不清空。
4. `bsr_provider_unsupported` → seg `unavailable_unsupported`；qty/value 維持原持倉數字，**不得**寫 0。
5. terminal 開 drawer：`enqueue_bsr_backfill` / `tw-institutional-daily-sync` 呼叫次數 = 0；`retryable`/`syncing`/`sparse` 仍照舊觸發。
6. 回歸：既有 holding 交易資料、美股／ETF／權證等 unsupported symbol 不變。
7. 波及防護：跑 `journal-authoring-*`、`journal-detail-*`、`signal-*` e2e 與 `bunx vitest run` 全量。

## F. Preview 驗收腳本（不得以 unit test 代替）

全新 incognito context、清 cache、**完全不開 drawer**：
1. 載入含 31+ 檔持倉的 checkup 頁 → 記錄 `POST **/tw-chips-detail-v2` 請求數（期望 2）與各批 `stock_ids` 長度。
2. 截圖卡片牆，斷言每張卡有 `holding-card-bsr`，terminal 者為 `unavailable_unsupported` 文案。
3. 收集 console errors（期望 0）與 network HAR。
4. 證據：`/tmp/browser/stageD/*.png`、HAR、request 表格；另存 terminal 卡片元素截圖。

## G. Remaining risk（誠實揭露）

admission gate 目前**關閉**（v8 `admission_blocked=true`），本階段只能讓 UI 誠實顯示「不支援／最後可得日期」，**不會**、也不准回補出新的 BSR 資料。背景新鮮度（BSR 停在 2026-08-17 之前）屬另案 remaining risk，不在 D 範圍，且本階段不打任何 provider。

## H. 未知／衝突

- D3 修復是否納入 edge（第 7 項）需你裁決：只改前端 → UI 會顯示 `unknown_degraded`（「上游狀態待確認」）而非「不支援」，D3 無法真正達成；改 edge 則需要一次 deploy（本階段不執行，等你另行核准）。
- `bsr_terminal_code` 欄位存在於 e2e fixture 但 v2 payload 目前不輸出；是否要正式加入 payload 契約，請一併裁決。
