# Stage 3B · S3B-0 完整矩陣（baseline 4 GREEN + RED 8）

環境：production-shape clone `postgresql://postgres@localhost:55931/clone?sslmode=disable`（Postgres 17.9，
pg_cron + pgvector），前端測試在本機 vitest / playwright。**production 全程未執行任何 mutation**。

## A. Baseline（必須 GREEN）4/4

| # | 測試 | 指令 | 結果 |
|---|------|------|------|
| B1 | `supabase/tests/bsr_gate_helper_acl_test.sql` | `psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f ...` | GREEN（無輸出即全案通過） |
| B2 | `supabase/tests/bsr_queue_selector_test.sql` | 同上 | GREEN |
| B3 | `supabase/tests/bsr_admission_gate_contract_test.sql`（Stage 1 留存） | 同上 | GREEN |
| B4 | `src/test/unit/holdings-quantity-source.test.ts` | `bunx vitest run src/test/unit/holdings-quantity-source.test.ts` | GREEN 4 passed |

B4 覆蓋：`pf-holdings-v2` 為唯一持倉 storage key；卡片樹禁止由 chips/bsr/institutional/quote/payload 取
qty/cost；行情缺值 → `—`；真實 `value=0` → `0`；今日損益缺值 → `—`。

## B. RED（必須以「正確原因」失敗）8/8

| # | 測試 | RED assertion message（實測） |
|---|------|------------------------------|
| R1 | `supabase/tests/bsr_gate_ingest_allowed_test.sql` | `case1: private_bsr.ingest_allowed() 不存在 —— S3B-A 尚未套用（預期 RED）`（case1–7：存在/簽章、DEFINER+STABLE+search_path、零授權、缺 row=true、false=true、true=false、config 損毀不 raise） |
| R2 | `supabase/tests/bsr_ingest_suppression_test.sql` | `case3: ensure_bsr_queued 應 early-return skipped，實得 {"status":"pending","created":true,...}` — **行為型 RED**：gate 關閉時 producer 仍真的寫 queue |
| R3 | `supabase/tests/bsr_availability_cas_test.sql` | `case1: partial_or_mismatched — version 必須為 8，實得 7`（fixture 重建 production v7 row，鎖定 7 鍵 + version=8） |
| R4 | `src/test/unit/bsr-canonical-code-mapping.test.ts` | `RED: @/checkup/lib/bsrCanonicalCodes 不存在 —— canonical 映射尚未實作` / `RED: mapProviderState 未導出` / `RED: ChipsSection.tsx 直接寫死 terminal 字面字串且未 import canonical 模組` |
| R5 | `src/test/unit/bsr-terminal-no-backfill.test.tsx` | `RED: machine 尚未認得 providerState，terminal 仍被判定應自動回補` / `RED: terminal 狀態仍發出 requestBackfill` / `RED: ChipsSection 未以 terminal 狀態 gate 手動回補按鈕`（非 terminal 分支仍 GREEN，證明不是全面停擺） |
| R6 | `src/test/unit/holdings-nodrawer-chips-consumer.test.tsx` | `RED: HoldingCard 樹沒有任何 chips 訂閱，未開抽屜就完全沒有 BSR 資訊` / `RED: 找不到 data-testid="holding-card-bsr"` / `RED: 卡片沒有 terminal 文案` |
| R7 | `src/test/unit/holdings-chips-chunking.test.ts` | `RED: 31 檔應分成 2 個請求，實得 1 個（sizes=30）—— useChipsBatch 仍是 slice(0, 30)` |
| R8 | `e2e/holdings-bsr-unavailable.spec.ts`（project `desktop-holdings-bsr-unavailable`） | 3 failed：① `data-seg-state` 期望 `unavailable_unsupported`，實得 `terminal_stale`；② `holding-card-bsr` count 0；③ 31 檔仍只發 1 個 batch |

指令：

```
psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/<file>.sql
bunx vitest run src/test/unit/holdings-quantity-source.test.ts \
  src/test/unit/bsr-canonical-code-mapping.test.ts \
  src/test/unit/bsr-terminal-no-backfill.test.tsx \
  src/test/unit/holdings-nodrawer-chips-consumer.test.tsx \
  src/test/unit/holdings-chips-chunking.test.ts
bunx playwright test --project=desktop-holdings-bsr-unavailable
```

vitest 統計：15 tests → baseline 4 passed、RED 10 failed、1 passed（R5 的「非 terminal 仍需回補」防呆案）。
playwright：3 failed（全為 R8 預期缺口）。

## C. 隔離協定與殘留證據

所有 SQL 測試共用 `supabase/tests/_s3b0_snapshot.sql`：`BEGIN` → `CALL s3b0_snapshot('before')` →
fixture 一律 `SAVEPOINT` → `CALL s3b0_assert_no_residue()` → `ROLLBACK`。
比對面向（缺一即 `test_left_residue`）：

- `tw_bsr_sync_queue`：`count(*)`、`(id,status)` md5、`max(updated_at)`、`max(enqueued_at)`
- `tw_bsr_sync_config`：全 key `version + md5(config)`
- `audit_logs`：`count(*)`
- `tw_bsr_degrade_events`：`count(*)`

RED 檔在 assertion 失敗時由 `ON_ERROR_STOP` 中止，整個外層交易回滾，同樣零殘留；
open 分支一律使用 fixture 個股（1104/1105），不觸碰任何 production row。

## D. production 唯讀 0 delta（本輪結束時實測）

| 欄位 | 值 |
|------|----|
| queue_rows | 10552 |
| queue_hash | `e747099c1ac7f231cebde744edf7757c` |
| queue max(updated_at) / max(enqueued_at) | 2026-08-21 07:02:00.081277+00 / 同 |
| config_hash（全 key version+md5） | `5200c548162ca2328bf55c25f0f313d8` |
| audit_logs count | 10690 |
| tw_bsr_degrade_events count | 94 |
| market_batch version | 7（仍未宣告 admission_*） |
| private_bsr schema / ingest_allowed | 存在 / **不存在**（RED 前提成立） |

queue_rows 與 market_batch=v7 與 Stage 1/Stage 2 收單值一致；本輪對 production 只做 catalog / 資料 SELECT。

## E. 本輪 changed files allowlist

```
docs/bsr/stage3b-s3b0-matrix.md                              (new)
supabase/tests/_s3b0_snapshot.sql                            (new)
supabase/tests/bsr_gate_ingest_allowed_test.sql              (new)
supabase/tests/bsr_availability_cas_test.sql                 (renamed from bsr_availability_canonical_v8_test.sql + v7 fixture + snapshot)
supabase/tests/bsr_gate_helper_acl_test.sql                  (snapshot 協定)
supabase/tests/bsr_queue_selector_test.sql                   (snapshot 協定)
supabase/tests/bsr_ingest_suppression_test.sql               (移除重複 helper case、行為 case 前置、snapshot 協定)
src/test/unit/holdings-quantity-source.test.ts               (new, baseline)
src/test/unit/bsr-canonical-code-mapping.test.ts             (new, RED)
src/test/unit/bsr-terminal-no-backfill.test.tsx              (new, RED)
src/test/unit/holdings-nodrawer-chips-consumer.test.tsx      (new, RED)
src/test/unit/holdings-chips-chunking.test.ts                (new, RED)
e2e/holdings-bsr-unavailable.spec.ts                         (new, RED)
playwright.config.ts                                         (+1 project: desktop-holdings-bsr-unavailable)
```

無 migration、無 deploy、無 cron/config/queue/data 異動、未 Publish。
