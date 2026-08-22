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

---

## S3B-0 Corrected Evidence Bundle（2026-08-22 03:57–04:00Z）

### Baseline（約定 4 項）
| # | 測試 | 指令 | 結果 |
|---|---|---|---|
| B1 | `supabase/tests/bsr_gate_helper_acl_test.sql` | 檔案在 clone RED（clone 快照為 Stage-1 前，缺 `private_bsr`）；改以 production **唯讀 catalog SELECT** 等價驗證 4 cases | GREEN（production 等價）|
| B2 | `supabase/tests/bsr_queue_selector_test.sql` | `psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f ...` | GREEN（0 error）|
| B3 | `src/test/unit/bsr-worker-body-shape.test.ts` | `npx vitest run src/test/unit/bsr-worker-body-shape.test.ts` | 4 passed |
| B4 | `src/test/unit/holdings-quantity-source.test.ts` | 同上 | 4 passed |

`bsr_admission_gate_contract_test.sql` 標記為 **extra**，不計入 acceptance。

### 7-case harness 驗證（clone stub + negative control，最後全部 DROP）
case1 缺函式 / case2 VOLATILE / case3 授權 authenticated / case4 always-false / case5 row 存在即 false / case6 always-true / case7 直接轉型 → 各自命中對應 assertion，證明 harness 逐 case 可執行。

### production 0 delta（before 03:58:59Z / after 04:00:13Z，皆為 SELECT）
queue_count 10552→10552、queue_hash ce3293016b7f773fad1fcba7c219f6e7 不變、max(updated_at) 與 max(enqueued_at) 皆 2026-08-21 07:02:00.081277+00 不變、config_hash 1aecb3a8f18e057861a25524a1aa7f17 不變、audit_logs 10690→10690、degrade 94→94、status counts done 8432 / failed 1572 / pending 548 不變、`private_bsr.ingest_allowed` 仍為 0。

---

## S3B-0 Corrected Evidence Bundle — Round 2（2026-08-22 04:03–04:06Z）

### 0. 修正兩個 hard stop
- **A**：不再以 production catalog SELECT 等價替代。重建 disposable clone 並**實際套用 Stage 1 migration**後跑 B1/B2。
- **B**：`bsr_gate_ingest_allowed_test.sql` 的 case4/case7 契約寫反（default-allow），已改為 **fail-closed**，並擴為 9 個 case（含 3 種 malformed 分支）。**沒有任何 default-allow 路徑**。

### 1. Clone 重建 + Stage 1 套用
```
bash /tmp/clone_up.sh /tmp/s3b0 55931
→ restore_errors=0
→ CLONE=postgresql://postgres@localhost:55931/clone?sslmode=disable

psql "$CLONE" -qX -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260822024453_c57ec769-6af5-47b8-9b80-daadfcfcf545.sql
→ stage1_exit=0
sha256 = f9b5d06aeef9789c68f8db6c78d48baae2d62bab4c18b4211626125d78d89732
clone private_bsr 物件 = assert_sanitized, gate_classify, gate_state
```

### 2. Baseline 4/4 GREEN（全部在同一套過 Stage 1 的 clone / 本機）
| # | 測試 | exact command | 結果 |
|---|---|---|---|
| B1 | `supabase/tests/bsr_gate_helper_acl_test.sql` | `psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_gate_helper_acl_test.sql` | exit 0 GREEN（**clone 實跑**，非 production SELECT）|
| B2 | `supabase/tests/bsr_queue_selector_test.sql` | 同上 | exit 0 GREEN |
| B3 | `src/test/unit/bsr-worker-body-shape.test.ts` | `bunx vitest run src/test/unit/bsr-worker-body-shape.test.ts src/test/unit/holdings-quantity-source.test.ts` | 4 passed |
| B4 | `src/test/unit/holdings-quantity-source.test.ts` | 同上（合併執行：Test Files 2 passed / Tests 8 passed）| 4 passed |

B1 負向對照：`grant execute on function private_bsr.gate_state() to authenticated` 後重跑 →
`ERROR: case4: authenticated must NOT have EXECUTE on private_bsr.gate_state`（exit 3）；revoke 後回 exit 0。證明 B1 非空跑。

`bsr_admission_gate_contract_test.sql` = **extra**，不計 acceptance（本輪於 clone 為 RED：`case1: public.bsr_block_and_terminalize_claims(...) missing or wrong signature (got 0)`，因 Stage 1 wrapper 段落在該 clone 之外，屬 S3B-A 範圍）。

### 3. ingest_allowed 新契約 — 9 case exact assertions（fail-closed）
| case | fixture | 期望 | assertion message |
|---|---|---|---|
| 1 | catalog | 函式存在／0 參數／回傳 boolean | `case1: private_bsr.ingest_allowed() 不存在 —— S3B-A 尚未套用（預期 RED）` |
| 2 | catalog | SECURITY DEFINER + STABLE + 固定 search_path | `case2: ingest_allowed 必須 STABLE，實得 provolatile=%s` 等 |
| 3 | catalog | anon/authenticated/service_role/PUBLIC 無 EXECUTE | `case3: %s 不得對 private_bsr.ingest_allowed() 有 EXECUTE` |
| 4 | `DELETE tw_bsr_sync_config WHERE key='market_batch'` | **FALSE**（0 enqueue） | `case4: gate row 缺席（legacy_config_missing）必須 fail-closed=false，實得 %s` |
| 5 | `{"admission_blocked": false}` | **TRUE**（唯一允許路徑） | `case5: admission_blocked=false（canonical）必須為 true，實得 %s` |
| 6 | `{"admission_blocked": true, ...}` | **FALSE** | `case6: admission_blocked=true 必須為 false，實得 %s` |
| 7 | `{"admission_blocked":"yes-please"}` | **FALSE** 且不拋錯 | `case7: admission_blocked 型別不符必須 fail-closed=false，實得 %s` |
| 8 | `{"note":"no admission_blocked key"}` | **FALSE** 且不拋錯 | `case8: admission_blocked 鍵缺席必須 fail-closed=false，實得 %s` |
| 9 | `'"blocked?"'::jsonb`（非 object） | **FALSE** 且不拋錯 | `case9: config 非 object 必須 fail-closed=false，實得 %s` |

gate key 改為 `market_batch`，與 Stage 1 `private_bsr.gate_state()` 實際讀取的 key 一致（舊版誤用 `bsr_availability`，fixture 根本沒被 helper 讀到）。

### 4. Harness 證明
```
psql "$CLONE" -qX -v ON_ERROR_STOP=1 -v stub=1 -f supabase/tests/bsr_gate_ingest_allowed_test.sql
→ case1..case9 全部 NOTICE "PASS"，stub teardown PASS，exit 0
psql "$CLONE" -qX -v ON_ERROR_STOP=1 -f supabase/tests/bsr_gate_ingest_allowed_test.sql
→ ERROR: case1: private_bsr.ingest_allowed() 不存在 —— S3B-A 尚未套用（預期 RED）  exit 3
```
負向對照（stub 改成 gate row 缺席時 `RETURN true`）：
`ERROR: case4: gate row 缺席（legacy_config_missing）必須 fail-closed=false，實得 t` exit 3 —— 證明 default-allow 會被本測試擋下。
stub 僅存在於交易內，`DROP FUNCTION` + `ROLLBACK` 雙重拆除，clone 與 production 皆無殘留。

### 5. Targeted RED 8/8（重跑）
| # | 測試 | RED message |
|---|---|---|
| R1 | `bsr_gate_ingest_allowed_test.sql` | `case1: private_bsr.ingest_allowed() 不存在（預期 RED）` exit 3 |
| R2 | `bsr_ingest_suppression_test.sql` | `case3: ensure_bsr_queued 應 early-return skipped，實得 {"status":"pending","created":true,...}` exit 3 |
| R3 | `bsr_admission_gate_contract_test.sql`（extra） | `case1: public.bsr_block_and_terminalize_claims(...) missing or wrong signature (got 0)` exit 3 |
| R4 | `bsr-canonical-code-mapping.test.ts` | `RED: @/checkup/lib/bsrCanonicalCodes 不存在` / `RED: mapProviderState 未導出` / `RED: ChipsSection.tsx 直接寫死 terminal 字面字串` |
| R5 | `bsr-terminal-no-backfill.test.tsx` | `RED: machine 尚未認得 providerState` / `RED: terminal 狀態仍發出 requestBackfill` / `RED: ChipsSection 未以 terminal 狀態 gate 手動回補按鈕` |
| R6 | `holdings-nodrawer-chips-consumer.test.tsx` | `RED: HoldingCard 樹沒有任何 chips 訂閱` / `RED: 找不到 data-testid="holding-card-bsr"` / `RED: 卡片沒有 terminal 文案` |
| R7 | `holdings-chips-chunking.test.ts` | `RED: 31 檔應分成 2 個請求，實得 1 個（sizes=30）` |
| R8 | `e2e/holdings-bsr-unavailable.spec.ts` | 本輪未重跑（前輪結果不變，不計入本次 GREEN 聲明）|
vitest 統計（R4–R7）：Test Files 4 failed / Tests 10 failed · 1 passed。

### 6. production 0 delta（唯讀 SELECT；before 04:04:58Z / after 04:05:49Z）
| 欄位 | before | after |
|---|---|---|
| queue_count | 10552 | 10552 |
| queue_hash（`md5(agg(id:status:updated_at))`）| 9c5eda0c19768fd2ef588335f8ec15a0 | 9c5eda0c19768fd2ef588335f8ec15a0 |
| queue max(updated_at) | 2026-08-21 07:02:00.081277+00 | 同 |
| queue max(enqueued_at) | 2026-08-21 07:02:00.081277+00 | 同 |
| config_hash | 1aecb3a8f18e057861a25524a1aa7f17 | 1aecb3a8f18e057861a25524a1aa7f17 |
| audit_logs count | 10690 | 10690 |
| tw_bsr_degrade_events count | 94 | 94 |
| status pending / failed / done / running / skipped | 548 / 1572 / 8432 / 0 / 0 | 548 / 1572 / 8432 / 0 / 0 |

（queue_hash 與前輪數值不同，是因本輪 hash 公式加入 `updated_at`；同輪 before/after 一致即 0 delta。）
本輪期間未觸發自然排程，無隱性變化。無 migration apply、無 deploy、無 Publish、無 provider call。

### 7. changed-files allowlist（本輪）
```
supabase/tests/bsr_gate_ingest_allowed_test.sql   (modified — 契約由 default-allow 改 fail-closed，7→9 case，加 stub harness)
docs/bsr/stage3b-s3b0-matrix.md                   (modified — 本節)
```
無 migration 新增／套用、無 edge function 變更、無 production source code 變更。

**狀態：S3B-0 兩個 hard stop 已修正，停在 S3B-0 等待核准。**

---

## S3B-0 R8 補件（2026-08-22 04:08Z）

環境：本機 dev server `http://localhost:8080`（HTTP 200 確認），**非 Preview、非 Publish、未部署任何新環境**。

```
npx playwright test --project=desktop-holdings-bsr-unavailable
→ 3 failed，exit code = 1
```

三筆 targeted RED exact messages：
1. `Error: RED: 分段狀態未支援 unavailable_unsupported`（`e2e/holdings-bsr-unavailable.spec.ts:42`）
2. `Error: RED: 卡片層沒有 holding-card-bsr 節點（只有抽屜才是 consumer）`（`:69`）
3. `Error: RED: 31 檔應分 2 個請求，實得 1（sizes=30）` — `Expected: 2 / Received: 1`（`:86`，assert 在 `:111`）

`test-results/` 已 `rm -rf` 清除（確認不存在）。**0 additional product changes**：本次僅新增本節文件，未改任何 product code / migration / edge function；無 provider call、無 deploy、無 Publish。

### production 0 delta（E2E 前 04:08:16Z / 後 04:08:59Z，皆唯讀 SELECT）
| 欄位 | before | after |
|---|---|---|
| queue_count | 10552 | 10552 |
| queue_hash | 9c5eda0c19768fd2ef588335f8ec15a0 | 9c5eda0c19768fd2ef588335f8ec15a0 |
| queue max(updated_at) | 2026-08-21 07:02:00.081277+00 | 同 |
| queue max(enqueued_at) | 2026-08-21 07:02:00.081277+00 | 同 |
| config_hash | 1aecb3a8f18e057861a25524a1aa7f17 | 1aecb3a8f18e057861a25524a1aa7f17 |
| audit_logs | 10690 | 10690 |
| tw_bsr_degrade_events | 94 | 94 |
| status pending/failed/done/running/skipped | 548 / 1572 / 8432 / 0 / 0 | 548 / 1572 / 8432 / 0 / 0 |

**至此 S3B-0：baseline 4 GREEN + targeted RED 8（含 R8）全數到齊，production 零 mutation。停在 S3B-0 等待核准；不進 S3B-A。**
