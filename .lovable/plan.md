# P-H5a：side-by-side 唯讀籌碼端點（tw-chips-detail-v2）

目標：讓抽屜請求不再觸發任何後端寫入，但**不覆寫**現有 production endpoint、不動 cron、不 Publish。

## 現況（已由本輪讀檔確認）

`supabase/functions/tw-chips-detail/index.ts`（590 行，`verify_jwt = false`）在每次單股請求路徑上仍會寫入：

- `rebuildAndRead()` → `supa.rpc('rebuild_bsr_rollup', { _as_of, _stock_ids, _max_stocks })`，於兩個分支觸發：
  1. `rollup` 分支且 `!bsr.d1 || !bsr.d10`
  2. `raw_fallback` 分支（`fallbackNewer`）必觸發
- `makeInflightHook()`（`_shared/coalesceDbHook.ts`）對 `finmind_inflight_requests` 做 upsert / delete。

因此目前**不可**宣稱「開抽屜無寫入」。文案更正見第 6 節。

## 交付範圍（本輪若 Approve 僅授權這些）

1. P0 production read-only preflight
2. 新增 `tw-chips-detail-v2`（新檔，不改舊檔）
3. 必要時新增一個唯讀 RPC（見下）
4. production no-write 驗收（連跑 3 次）
5. Preview 以 harness/build-time flag 指向 v2，production build 預設仍走舊 endpoint

**不授權**：Publish、覆寫舊 endpoint、切 cron、任何既有 data DML、修改既有 function/table/ACL。

## 1. 舊 public contract 盤點（v2 必須逐項相容）

| 面向 | 舊行為 | v2 |
| --- | --- | --- |
| JWT | `config.toml` `verify_jwt = false` | 相同（新增 `[functions.tw-chips-detail-v2] verify_jwt = false`） |
| CORS | `_shared/cors.ts` `corsPreflight` / `jsonResponse` / `errorResponse` | 相同模組 |
| Methods | GET / POST，其他 405 `METHOD_NOT_ALLOWED` | 相同 |
| 入參 | `?stock_id`、`?stock_ids`、`?stamp_only=1`、body `{stock_id}` / `{stock_ids}` | 相同 |
| 驗證 | `isValidId` `/^[0-9A-Za-z]{3,10}$/`、`MAX_BATCH=30`、重複 id 400 | 相同 |
| Stamp | `computeChipsStamp`（純 SELECT） | 沿用 |
| Cache | `memoryCache` TTL 5 分、`_cache_meta.{cache,stamp_ver,served_at}` | 沿用 |
| Coalesce | `requestCoalescer` + `makeInflightHook`（**有寫入**） | 保留 coalescer，**移除** inflight hook（改用 no-op observer） |
| Batch | `withConcurrency(…,3)`、`{results,errors,count,failed,served_at}` | 相同 |
| Payload | 40+ 欄位（`bsr_*`、`institutional`、`series`、`readiness`、`upstream_circuit`、`snapshot_state`…） | 欄位鍵、型別、順序語意完全一致 |
| Error | 400 `BAD_REQUEST` / 405 / 500 `INTERNAL_ERROR` | 相同 |

唯一行為差異：**移除所有 write / rebuild / enqueue**。當 rollup 缺 `d1`/`d10` 或走 raw fallback 時，v2 **不 rebuild**，改以既有 rollup 列填值，缺者留 `null`，並在既有語意內回報（`bsr_source`、`bsr_fallback_used`、`bsr_freshness_status`）。契約新增欄位僅 `_readonly: true`（additive，不影響既有 consumer）。

## 2. RPC 決策

先於 P0 以 `pg_proc.provolatile` 確認既有 read RPC（`get_bsr_daily_series`、`tw_bsr_eligibility`、`compute_bsr_series_readiness`）是否為 STABLE/IMMUTABLE 且無寫入。

- **若全部確認唯讀** → 不新增任何 function（優先路徑），v2 只用既有 RPC + 表 SELECT。
- **若 `tw_bsr_eligibility` 或 series RPC 為 VOLATILE / 含寫入** → 才新增：

```sql
BEGIN;
CREATE OR REPLACE FUNCTION public.get_chips_detail_ro(_stock_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$ ... 純 SELECT ... $$;
REVOKE ALL ON FUNCTION public.get_chips_detail_ro(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chips_detail_ro(text) TO service_role;
COMMIT;
```

CREATE 與 REVOKE 同一 transaction，避免預設 PUBLIC EXECUTE 窗口。不 `ALTER` 任何既有 function/table/ACL。

## 3. P0 production preflight（read-only，全部先跑）

1. fresh logical backup → 新 disposable clone restore proof（0 unexpected / 0 expected errors，schema/constraint/index/RLS/ACL/rowcount/hash 對齊 baseline）。
2. 舊 endpoint 3 symbols（`2330` ready、一個 cache-miss pending、一個 unsupported/stale）baseline payload 存檔 + sha256。
3. 四表以上 fingerprint：`tw_bsr_sync_queue`、`tw_bsr_attempt_logs`、`tw_chips_rollup`、`bsr_coverage_daily`、`tw_chip_fact`、`tw_bsr_daily` 的 rowcount + `max(updated_at)` + data hash。
4. writer RPC counters：`pg_stat_user_functions` 對 `rebuild_bsr_rollup` 等的 calls 基準值。
5. current function / ACL hashes：`pg_get_functiondef` + `proacl` 快照。

任一項不符 → **stop point**，不進 apply。

## 4. Apply（最小 production 變更）

僅兩類新增，無既有物件變更、無 data DML：

- 新檔 `supabase/functions/tw-chips-detail-v2/index.ts`（＋ `config.toml` 追加 v2 區塊）
- 條件性新增 `get_chips_detail_ro`（見第 2 節）

不 deploy 舊 function、不改 cron、不 Publish。

## 5. Production 驗收

三類 case：`ready`（2330）、`pending`（cache miss 新代碼）、`unsupported/stale`。每次呼叫前後：

- 六表 rowcount + `max(updated_at)` + hash 全不變
- `rebuild_bsr_rollup` 呼叫數增量 = 0
- statement capture（`pg_stat_statements` / log capture）：0 DML、0 volatile writer
- 連跑 3 次，log 與 correlation id 完整存檔

## 6. Rollback

刪除 / 停用 `tw-chips-detail-v2`，`DROP FUNCTION get_chips_detail_ro`（若有建）。舊 endpoint、舊 ACL、data hash 完全不變。

## 7. Preview 切換

`src/checkup/lib/chipsRepository.ts` 的 endpoint 字串抽成常數，由 build-time flag（`import.meta.env.VITE_CHIPS_ENDPOINT`，預設 `tw-chips-detail`）決定；Preview / harness 才設為 v2。實際以 Playwright 對 Preview 做 DOM + visual 驗證（`chips-section`、`chips-freshness-segments`、`visual-chips-section`），mock 只用於契約測試、不當 production evidence。

## 8. 文案更正

所有既有文件（`db/r1/c/H/coverage_audit.md`、H5/H6 結論）改寫為：

> 前端自身不 enqueue，但舊後端 `tw-chips-detail` 每次請求仍可能呼叫 `rebuild_bsr_rollup` 寫入；**H5-server 未完成**。

## 風險

- v2 移除 rebuild 後，缺 `d1`/`d10` 的個股在 v2 會呈現空窗 → 屬預期，由 freshness 語意呈現，不得靠寫入補。
- 舊 endpoint bundle hash 未知 → 全程不 redeploy 舊 function。
- `finmind_inflight_requests` 移除寫入 → coalesce 觀測性下降，可接受（best-effort）。
