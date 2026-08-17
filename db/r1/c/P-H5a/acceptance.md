# P-H5a · side-by-side read-only endpoint 驗收記錄

日期：2026-08-17 UTC。Production mutation 僅一項：**新增部署 Edge Function `tw-chips-detail-v2`**。
未 deploy/redeploy/delete 舊 `tw-chips-detail`；未建立任何 DB object；未執行任何 DML／migration／cron 變更；未 Publish。

## 1. 舊契約 baseline（未呼叫舊 endpoint）

- 來源：`supabase/functions/tw-chips-detail/index.ts` source（sha256 見 `p0_source_hashes.txt`）＋既有 contract tests / fixtures
  （`e2e/chips-section.spec.ts`、`chips-telemetry-contract.spec.ts`、`chips-batch.spec.ts`、`chips-coalesce.spec.ts`）。
- 缺口（誠實標記）：**無已保存的舊 endpoint historical response artifact**，因此 byte-level 舊/新回應比對不可得；
  契約一致性以 source diff（見下）＋ mock 契約測試全綠佐證。
- production 資料形狀以直接 SELECT 取得（`fp_p0_baseline.txt`）。

## 2. v2 與舊版差異（唯一允許的差異＝移除寫入）

| 位置 | 舊 | v2 |
| --- | --- | --- |
| import | `makeInflightHook`（`_shared/coalesceDbHook.ts`） | 移除 |
| L135-160 | `rebuildAndRead()` → `rpc('rebuild_bsr_rollup')` + 重讀 | `readRollupForDate()` → 只 `SELECT tw_chips_rollup` |
| rollup 缺 d1/d10 | 觸發 rebuild | 不重建，留 null 由 freshness 語意表達 |
| coalesce | 帶 `onAcquire/onRelease`（寫 `finmind_inflight_requests`） | 無 DB hook（仍保留 in-memory coalesce） |
| payload | — | additive `_readonly: true` |

其餘 payload key/type、CORS、`verify_jwt=false`、batch(POST)、stamp_only、error semantics 全數保留。

## 3. Static denylist audit（v2 + 其 import closure）

`index.ts` 與 `_shared/{supabaseClients,cors,memoryCache,requestCoalescer,chipsStamp,bsrRollup,tradingDate,seriesReadiness}.ts`：
無 `rebuild_bsr_rollup` / `makeInflightHook` / `finmind_inflight_requests` / `enqueue` / `.insert(` / `.update(` / `.upsert(` / `.delete(`
（唯二命中為 `Map.delete()` 的 in-memory cache 清理，非 DB 寫入）。
v2 呼叫的 RPC 僅 2 個且皆 `STABLE`：`get_bsr_daily_series`、`tw_bsr_eligibility`。

## 4. Production no-write 驗收（只呼叫 v2）

三類真實 case 以 read-only SELECT 挑選，各連跑 3 次（共 9 次，全部 `http=200`、全部 `cache=miss` → 每次都真的走 DB path）：

| case | symbol | 結果 |
| --- | --- | --- |
| ready/有 BSR | 2330 | `bsr_as_of=2026-08-14`, status=`syncing`, `_readonly=true` |
| pending/回補中 | 3152 | `bsr_as_of=2026-08-14`, status=`syncing`, `_readonly=true` |
| unsupported | 00878 | status=`ineligible`, reason=`unsupported_asset_type` |

fingerprint（7 表：`tw_bsr_daily` / `tw_chip_fact` / `tw_chips_rollup` / `tw_bsr_sync_queue` / `bsr_coverage_daily` /
`tw_bsr_attempt_logs` / `finmind_inflight_requests`）：
`fp_pre_run.txt` 與 `fp_post_run.txt` **逐行完全相同**（rowcount / max(timestamp) / md5 全同）。
另以時間窗查核 11:36:00Z 之後新寫入列數：queue=0、coverage=0、rollup=0、inflight=0、attempt_logs=0。

缺口（GAP-2）：`pg_stat_statements` 不可用、`track_functions=none`，故 writer function call delta 無法由 counter 直接證明；
本輪未 reset / ALTER 任何監控設定，改以 table fingerprint（含 inflight 表）＋ static call-graph/source audit 佐證。

## 5. Preview 驗證（非 mock）

`.env.development.local`（`.gitignore` 的 `.env.*` 涵蓋，**不進 repo、不影響 production build**）設定
`VITE_CHIPS_ENDPOINT=tw-chips-detail-v2`；`chipsRepository.ts` 以 `CHIPS_FN` 統一組 URL，預設仍是 `tw-chips-detail`。

實機瀏覽器（非 mock）確認實際請求為
`https://<project>.functions/v1/tw-chips-detail-v2?stock_id=2330(&stamp_only=1)`，DOM 完整渲染三大法人／券商分點／集中度／趨勢圖，console error = 0。

E2E：`desktop-chips-section`、`desktop-chips-freshness-segments`、`mobile-chips-section`、`visual-chips-section`、
`desktop-chips-coalesce`、`desktop-chips-batch`、`desktop-chips-telemetry-contract` 全綠（59 + 5 passed）。

## 6. Rollback（已備、未執行）

新增物件只有一個 Edge Function，因此回滾為單一動作：

1. 停用／刪除 `tw-chips-detail-v2`（delete_edge_functions `["tw-chips-detail-v2"]`）。
2. 移除 `supabase/config.toml` 的 `[functions.tw-chips-detail-v2]` 區塊與 `supabase/functions/tw-chips-detail-v2/`。
3. 刪除 `.env.development.local`（Preview 立即回舊 endpoint）。

未建立任何 DB function／ACL 變更，故無 DROP FUNCTION / REVOKE 需回滾；舊 endpoint、舊 ACL、資料 hash 全程未變。

## 7. 狀態界線（不得誤述）

- v2 server：**已部署、no-write 驗收通過**。
- Preview：**已指向 v2，UI/E2E 通過**。
- Production 前端：**尚未 Publish**，真實使用者仍走舊 `tw-chips-detail`，因此「開抽屜觸發後端 rebuild 寫入」的原症狀**尚未對使用者解除**。
