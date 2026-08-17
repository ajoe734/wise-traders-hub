# P-H5a：side-by-side 唯讀籌碼端點（tw-chips-detail-v2）— 修訂版

目標：讓籌碼抽屜請求不再觸發任何後端寫入，做法是**並列新增**一個唯讀 Edge Function，舊端點原地不動；本輪不 Publish、不切 production frontend、不改 cron、不改任何既有 object/ACL/data。

## 現況（本輪讀檔已確認）

`supabase/functions/tw-chips-detail/index.ts`（590 行，`verify_jwt = false`）在單股請求路徑上會寫 DB：

- `rebuildAndRead()` → `supa.rpc('rebuild_bsr_rollup', {_as_of,_stock_ids,_max_stocks})`；觸發於 (a) rollup 分支且缺 `d1`/`d10`，(b) `raw_fallback` 分支必觸發。
- `makeInflightHook()`（`_shared/coalesceDbHook.ts`）對 `finmind_inflight_requests` upsert / delete。

**推論：P0 期間一次都不得呼叫舊端點。**

## 0. 不可違反的紅線

- 舊 `tw-chips-detail`：0 次 HTTP 呼叫、0 次 deploy/redeploy/delete。
- 既有 function / table / ACL / data：0 mutation、0 DML。
- 監控：`pg_stat_statements` 只讀，不 reset、不 ALTER、不改任何監控設定。
- 不 Publish、不改 production frontend 預設端點、不改 cron。

## 1. 舊契約 baseline —— 不呼叫舊端點的取證方式

| 證據來源 | 內容 |
| --- | --- |
| Source code | `tw-chips-detail/index.ts` 全文 sha256；逐欄位抽出 response schema（40+ keys）、error semantics、入參規則 |
| 既有 contract tests | `src/test/integration/tw-chips-detail-public-contract.test.ts`、`bsr-sealing-lifecycle.test.ts`、`bsr-fallback-attribution.test.ts`、`bsr-daily-series-source-of-truth.test.ts` |
| 既有 fixtures / E2E mock payload | `e2e/chips-section*.spec.ts`、`chips-freshness-segments.spec.ts`、`chips-telemetry-contract.spec.ts`、`chips-batch.spec.ts`、`chips-coalesce.spec.ts` 中的 mock payload |
| Historical response artifacts | 若 repo/artifact 目錄存有先前保存的真實回應則採用；**若不存在，明確標記為 GAP-1：無 live 舊端點 baseline，且不以呼叫舊端點補足** |
| Production 資料形狀 | 只用 `supabase--read_query` 直接 SELECT 六表與相關 RPC 定義 |

盤點的舊 public contract（v2 必須逐項相容）：

| 面向 | 舊行為 | v2 |
| --- | --- | --- |
| JWT | `verify_jwt = false` | 相同（新增 `[functions.tw-chips-detail-v2]`） |
| CORS | `_shared/cors.ts` 的 `corsPreflight/jsonResponse/errorResponse` | 相同模組 |
| Method | GET/POST，其他 405 `METHOD_NOT_ALLOWED` | 相同 |
| 入參 | `?stock_id` / `?stock_ids` / `?stamp_only=1` / body `{stock_id}`、`{stock_ids}` | 相同 |
| 驗證 | `isValidId` `/^[0-9A-Za-z]{3,10}$/`、`MAX_BATCH=30`、重複 400 | 相同 |
| Stamp | `computeChipsStamp`（純 SELECT） | 沿用 |
| Cache | memoryCache TTL 5 分、`_cache_meta.{cache,stamp_ver,served_at}` | 沿用 |
| Coalesce | `requestCoalescer` + `makeInflightHook`（**寫 DB**） | 保留 coalescer，改 no-op observer |
| Batch | `withConcurrency(...,3)`、`{results,errors,count,failed,served_at}` | 相同 |
| Payload | `institutional`/`bsr`/`bsr_*`/`series`/`readiness`/`upstream_circuit`/`snapshot_*` | 鍵名、型別、語意一致；僅 additive 加 `_readonly: true` |
| Error | 400 `BAD_REQUEST` / 405 / 500 `INTERNAL_ERROR`（不含內部細節） | 相同，且不外洩 service-role 欄位或 DB 錯誤細節 |

唯一行為差異：移除所有 write / rebuild / enqueue。缺 `d1`/`d10` 時不 rebuild，留 `null`，由既有 `bsr_source` / `bsr_fallback_used` / `bsr_freshness_status` 表達。

## 2. P0 preflight（全 read-only，不碰舊端點）

1. `pg_get_functiondef` + 完整 source body 稽核：`rebuild_bsr_rollup`、`get_bsr_daily_series`、`tw_bsr_eligibility`、`compute_bsr_series_readiness`、`expected_latest_bsr_date` — 逐一檢查是否含 INSERT/UPDATE/DELETE/`PERFORM` writer 呼叫；**不只看 `provolatile`**。
2. 六表 fingerprint（rowcount + `max(updated_at)` + 內容 hash）：`tw_bsr_sync_queue`、`tw_bsr_attempt_logs`、`tw_chips_rollup`、`bsr_coverage_daily`、`tw_chip_fact`、`tw_bsr_daily`。
3. Writer counter baseline：`pg_stat_user_functions` / `pg_stat_statements`（只讀；不可用則標 GAP-2 並改以 fingerprint + static call-graph 補強）。
4. 現行 function ACL 快照：`proacl` + `pg_get_functiondef` hash。
5. Fresh logical backup → disposable clone restore proof（0 unexpected / 0 expected errors；schema/constraint/index/RLS/ACL/rowcount/hash 對齊 baseline）。
6. 以 SELECT 選出三類真實驗收 case（不得靠舊端點製造）：
   - `ready`：`2330`（rollup 有 d1/d5/d10/d20 且 `bsr_available`）
   - `cache-miss/pending`：queue 為 pending/running 或 rollup 缺窗的真實代碼
   - `unsupported/stale`：`tw_bsr_eligibility` 判 ineligible 或 as_of 明顯落後者

**STOP-1**：任一項不符或 clone restore 有 error → 停，不進 Apply。

## 3. Exact production mutations（Apply 內容，僅此三項）

1. **新增 repo 檔** `supabase/functions/tw-chips-detail-v2/index.ts`（由舊檔複製後移除寫入路徑）。
2. **Side-by-side deploy 全新 Edge Function**
   - Deploy target：本專案 Lovable Cloud 後端（ref `yqacmrgdjlenbijclngi`）
   - 工具：`supabase--deploy_edge_functions`，`function_names: ["tw-chips-detail-v2"]`（陣列只含 v2）
   - config：`supabase/config.toml` 追加 `[functions.tw-chips-detail-v2] verify_jwt = false`
   - 預期 URL：`<functions base>/tw-chips-detail-v2`
   - Read-back：部署前後各取一次 function 清單 + 版本，證明 v2 由無→有、`tw-chips-detail` 版本號與 updated_at 完全不變
3. **條件性** 新增 `get_chips_detail_ro`（僅在第 2 節稽核顯示既有 read RPC 含 volatile/writer 時才做；否則不新增任何 function）：

```sql
BEGIN;
CREATE FUNCTION public.get_chips_detail_ro(_stock_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$ /* 僅 SELECT；不得呼叫任何 VOLATILE/writer function */ $$;
REVOKE ALL ON FUNCTION public.get_chips_detail_ro(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chips_detail_ro(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chips_detail_ro(text) TO service_role;
COMMIT;
```

CREATE + REVOKE + GRANT 同一 transaction，杜絕預設 PUBLIC EXECUTE 窗口。不 `ALTER`、不 `CREATE OR REPLACE` 任何既有物件，不做任何 data DML。

**STOP-2**：deploy read-back 顯示舊 function 版本有變 → 立即 rollback 並停。

## 4. v2 static denylist audit（Apply 前必須全綠）

對 `tw-chips-detail-v2/index.ts` 及其 import 閉包做 grep + call-graph 檢查，以下任一命中即 FAIL：

- `rebuild_bsr_rollup`、任何 `enqueue*`、`*_sync_*` writer RPC
- `makeInflightHook`、`coalesceDbHook`、`finmind_inflight_requests`
- `.insert(`、`.update(`、`.upsert(`、`.delete(`
- 任何在第 2 節稽核中被標為 VOLATILE / writer 的 RPC

另外驗證：

- `get_chips_detail_ro`（若建立）對 `anon`、`authenticated` 直接 EXECUTE 為 **denied**（以角色模擬查詢驗證）。
- v2 回應欄位集合 ⊆ 舊 contract 欄位 ∪ `{_readonly}`，無 service-role 專屬欄位、無 DB 錯誤細節外洩。

## 5. Production no-write 驗收（只呼叫 v2）

對第 2.6 節選出的三類真實 case，各連跑 3 次（共 9 次），每次呼叫前後：

| 檢查項 | 期望 |
| --- | --- |
| 六表 rowcount | 前後完全一致 |
| 六表 max timestamp | 前後完全一致 |
| 六表內容 fingerprint（hash） | 前後完全一致 |
| `rebuild_bsr_rollup` 及其他 writer function call delta | 0 |
| statement capture（read-only 觀察） | 0 DML、0 volatile writer；不可用則標 GAP-2 並以 fingerprint + static audit 補強，不宣稱已證明 |
| 回應契約 | 與第 1 節 contract 表逐欄比對通過 |
| log / correlation id | 9 次皆完整存檔 |

**STOP-3**：任一 fingerprint 變動或 writer delta > 0 → 立即 rollback，停止並回報。

## 6. Rollback（先寫好並演練，驗收成功後不執行刪除）

- 停用/刪除 v2：`supabase--delete_edge_functions(["tw-chips-detail-v2"])`；移除 `config.toml` 的 v2 區塊與 repo 目錄。
- 若建立過 RPC：`DROP FUNCTION public.get_chips_detail_ro(text);`
- 驗證舊端點定義 hash、ACL 快照、六表 data hash 與 P0 baseline 逐位元相同。
- 演練在 disposable clone 上跑一次（證明可逆），production 僅在 STOP-2/STOP-3 觸發時才實際執行。

## 7. Preview flag（preview/harness-only）

`src/checkup/lib/chipsRepository.ts` 的端點字串抽為常數，由 build-time flag 決定：

```
CHIPS_FN = import.meta.env.VITE_CHIPS_ENDPOINT ?? 'tw-chips-detail'
```

- production build 未設此變數 → 仍走舊 `tw-chips-detail`。
- Preview / Playwright harness 才設為 `tw-chips-detail-v2`。
- 驗證：對 Preview 做真實 DOM + visual 檢查（`chips-section`、`chips-section-mobile`、`chips-freshness-segments`、`visual-chips-section`），mock 僅用於契約測試，不當作 production evidence。

## 8. Acceptance matrix

| ID | 項目 | 通過條件 |
| --- | --- | --- |
| A1 | P0 read-only | 全程 0 次舊端點呼叫、0 DML；clone restore 0 error |
| A2 | Contract 對齊 | v2 欄位/錯誤語意與 source-derived contract 一致 |
| A3 | Static denylist | 第 4 節全部項目 0 命中 |
| A4 | ACL | RPC（若建）anon/authenticated EXECUTE denied；service_role 允許 |
| A5 | Deploy 隔離 | v2 新增、舊 function 版本/updated_at 不變 |
| A6 | No-write | 9 次呼叫六表 fingerprint 不變、writer delta = 0 |
| A7 | Rollback | clone 演練成功；commands 可逆且已備妥 |
| A8 | Preview | Preview 指向 v2，DOM/visual/E2E 通過 |
| A9 | 文案 | 見第 9 節，無過度宣稱 |

## 9. 文案與最終報告口徑

現有文件（`db/r1/c/H/coverage_audit.md`、H5/H6 結論）一律改為：

> 前端自身不 enqueue，但舊後端 `tw-chips-detail` 每次請求仍可能呼叫 `rebuild_bsr_rollup` 寫入；**H5-server 未完成**。

最終報告必須分三段陳述，不得混為一談：

1. v2 server 已部署且 production no-write 驗收通過。
2. Preview 已指向 v2，UI/E2E 通過。
3. **production frontend 尚未 Publish，真實使用者仍走舊 `tw-chips-detail`，原症狀尚未正式解除。**

## 10. 風險

- v2 不 rebuild → 缺 `d1`/`d10` 的個股在 Preview 呈現空窗，屬預期，只能由 worker/cron 側補資料，不得由請求路徑寫入。
- 舊 endpoint bundle hash 未知 → 全程不 redeploy 舊 function，避免不可逆覆寫。
- 移除 inflight hook → coalesce 觀測性下降（best-effort，可接受）。
- `pg_stat_statements` 若不可用 → GAP-2，證據強度標示為「fingerprint + static audit」，不宣稱 statement-level 已證明。
