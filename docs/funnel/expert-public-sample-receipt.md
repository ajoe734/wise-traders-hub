# Expert Public Sample（公開週記範例）— Receipt

Status: **PARTIAL — 初始核准尚未完成**（0 個老師已核准樣本；需 company_admin session 逐位 preview/approve）
Scope: Preview only。deploy = 0，Publish = 0。
Date: 2026-08-21 (UTC)

---

## 1. Migrations（exact names，皆已 applied 並 readback）

| # | Migration | 內容 |
|---|---|---|
| 1 | `supabase/migrations/20260821200916_763b7bba-4e7e-419d-942c-f9aee6b291f2.sql` | 建表 `public.expert_public_samples`、RLS、unique index、6 支函數 |
| 2 | `supabase/migrations/20260821201014_dd9f1c33-8298-4fcc-9101-8a0e7e328633.sql` | 覆寫預設 grants：REVOKE EXECUTE（anon / authenticated） |
| 3 | `REVOKE ALL ON TABLE public.expert_public_samples FROM anon, authenticated;`（本輪新增） | 修正自我審查發現的缺口：base table 曾因資料庫預設權限對 anon/authenticated 有 SELECT/INSERT/UPDATE/DELETE |

### Readback — function privilege matrix（`has_function_privilege`）

| function(args) | anon | authenticated | service_role | secdef | search_path |
|---|---|---|---|---|---|
| `sample_redact_m1(_text text)` | ✗ | ✗ | ✓ | invoker (IMMUTABLE) | `pg_catalog, public, pg_temp` |
| `build_expert_public_sample(uuid, date, jsonb)` | ✗ | ✗ | ✓ | definer | 同上 |
| `preview_expert_public_sample(uuid, date, jsonb)` | ✗ | ✓ (內部 admin gate) | ✓ | definer | 同上 |
| `approve_expert_public_sample(uuid, date, jsonb)` | ✗ | ✓ (內部 admin gate) | ✓ | definer | 同上 |
| `revoke_expert_public_sample(uuid)` | ✗ | ✓ (內部 admin gate) | ✓ | definer | 同上 |
| `admin_expert_public_sample_status(uuid)` | ✗ | ✓ (內部 admin gate) | ✓ | definer | 同上 |
| `get_expert_public_sample(_slug text)` | ✓（刻意公開） | ✓ | ✓ | definer | 同上 |

### Readback — base table privileges（migration 3 之後）

| role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| anon | false | false | false | false |
| authenticated | false | false | false | false |
| service_role | true | true | true | true |

`relrowsecurity = true`，policies = 0（deny-all；所有存取一律走 SECURITY DEFINER RPC）。

---

## 2. Changed / new files（本輪 + 前輪合計）

新增：
- `supabase/migrations/20260821200916_*.sql`
- `supabase/migrations/20260821201014_*.sql`
- `src/hooks/useExpertPublicSample.ts`
- `src/hooks/useExpertSampleAdmin.ts`
- `src/lib/sampleRedaction.ts`
- `src/pages/_expert/RealSampleCard.tsx`
- `src/pages/_admin/PublicSampleDialog.tsx`
- `src/test/unit/realSampleCard.state.test.tsx`（本輪）
- `src/test/unit/expertPublicSample.migration.contract.test.ts`（本輪）
- `docs/funnel/expert-public-sample-receipt.md`（本檔）

修改：
- `src/lib/complianceCopy.ts`（新增 `REAL_SAMPLE_EMPTY = '目前尚無公開範例'`，納入 `allCopyStrings()`）
- `src/pages/ExpertProfile.tsx`（掛載 `RealSampleCard`）
- `src/hooks/useExpertPublicSample.ts`（本輪 `retry: false`，讓 error 態確定可見）

刪除（本輪）：
- `src/pages/_expert/SampleStructureCard.tsx` — 假骨架 fallback，違反已核准契約，整支移除。

---

## 3. 三態契約（P1 修正）

| 狀態 | 條件 | 畫面 |
|---|---|---|
| loading | query pending | `data-testid="real-sample-loading"`，`aria-busy="true"`，只有遮罩條，無任何欄位名 |
| error | RPC / network error（不重試） | `data-testid="real-sample-error"`，文案「資料暫時無法取得」 |
| empty | RPC 成功但 0 row / 未核准 / sections 為空 | `data-testid="real-sample-empty"`，文案「目前尚無公開範例」 |
| ready | 已核准 snapshot | `data-testid="real-sample"`，只渲染伺服器遮罩後文字 |

完成後絕不保留假結構；empty 態不出現「訂閱後可見」或任何虛構欄位。

Live Preview（393×1800，dev server，非 mock）：

```
master-brian real-sample-empty TEXT: 過去週記節錄 |  | 目前尚無公開範例   hasFakeFields: 0
sharkgu      real-sample-empty TEXT: 過去週記節錄 |  | 目前尚無公開範例   hasFakeFields: 0
master-zhou  real-sample-empty TEXT: 過去週記節錄 |  | 目前尚無公開範例   hasFakeFields: 0
```

---

## 4. 安全與資料契約

- **公開投影**：`get_expert_public_sample` 僅回 6 欄 `expert_name, expert_slug, week_start_taipei, sections, mask_level, updated_at`；不含 raw text、`source_content_hash`、`source_selections`、`approved_by`。且僅回 active mentor + `status='approved'`。
- **Provenance**：client 只能傳 `_expert_id, _week_start, _selections[{signal_id, source_field}]`。伺服器自行 fetch 原文；不接受任何 client 傳入文字。守門錯誤：`not_authorized`、`expert_not_active_mentor`、`week_not_closed`、`bad_selections`、`bad_selection_count`(2–4)、`bad_selection_keys`、`bad_source_field`、`bad_signal_id`、`duplicate_selection`、`signal_not_found`、`cross_teacher_selection`、`signal_not_published`、`signal_week_mismatch`。
- **source_field 白名單**：`reason_summary, reason_detail, risk_notes, learning_points, overall_summary`。
- **M1 遮罩**：價格／數量／比例確定性替換；PII（email、電話、URL/LINE/@handle、稱謂人名）與未來指令句一律 fail-closed；殘留未分類數字（5 位以上或 2 位小數）fail-closed。任一段落 `ok=false` → `redaction_gate_failed`，整筆不寫入。
- **Payload limits**：單段 `left(masked, 1200)` + `truncated`；`sections` JSON `octet_length > 8192` → `payload_too_large`；section 數 2–4。
- **XSS**：`sections[].text` 以 plain text 渲染（`whitespace-pre-wrap`），無 `dangerouslySetInnerHTML`。
- **Immutable / drift**：snapshot 寫入即固定；`source_content_hash`（sha256 of raw concat）供 `admin_expert_public_sample_status` 比對，原文變動只回報 `source_drifted=true`，**不會自動更新公開內容**。
- **單一有效樣本**：`expert_public_samples_one_approved` unique index (`expert_id) WHERE status='approved'`。
- **raw `expert_signals` 未變更**：本輪兩支 migration 對 `expert_signals` 無 `ALTER/GRANT/REVOKE/POLICY`（由 contract test 強制）；RLS policy 集合 md5 = `98c743900857c92d8eba1fdea285e7de`。
- **Linter**：本次僅檢視新增函數；SECURITY DEFINER / search_path 通知未使用 “Try to fix all”，未動既有 246 項既存 findings。

---

## 5. Tests（exact commands / counts）

| Command | Result |
|---|---|
| `bunx vitest run src/test/unit/realSampleCard.state.test.tsx src/test/unit/complianceCopy.test.ts src/test/unit/expert-profile-public.contract.test.ts` | 3 files / 17 passed |
| `bunx vitest run src/test/unit/expertPublicSample.migration.contract.test.ts` | 1 file / 9 passed |
| `bunx vitest run`（full regression，補跑上一輪被略過的那條） | 見下方 §6 最終數字 |
| `bunx tsgo --noEmit` | exit 0，0 errors |
| `bun run build` | exit 0，built |
| Playwright live preview `/expert/{master-brian,sharkgu,master-zhou}` | 三站皆 `real-sample-empty` + exact 文案，fake fields = 0 |

上一輪只回報 unit 1276 passed，被跳過的是 **完整 `bunx vitest run`（full regression）**；本輪已重跑，未省略。

---

## 6. 最終 full regression

`bunx vitest run` → **242 files（240 passed / 2 skipped）、2990 tests passed / 8 skipped**（含本輪新增 14 tests）。

---

## 7. 尚未完成（partial）

- 4 位 mentor（`sharkgu` 2026-07-20、`master-zhou` 2026-08-03、`master-brcto` 2026-08-03、`master-lever` 2026-07-27）的**初始核准尚未執行**；需 company_admin browser session 於 `/admin/:slug/signals` → 「公開週記範例」逐位 preview/approve。
- `master-brian`（0 篇 published）與 `benny`（pending，已裁決不納入）無候選週。
- 未 deploy、未 Publish。

---

## Round 2 — audit provenance + normalization/redaction v2（PARTIAL）

狀態：**PARTIAL — 尚未寫入任何樣本資料（`expert_public_samples` 仍 0 rows）**。
Preview only。deploy = 0、Publish = 0。未觸碰 `expert_signals` 的 RLS／grants／資料。

### Migrations applied（本輪 4 支，皆 applied + readback OK）
1. `20260821204150_2e682de9-e5ff-4306-b17b-6ec9e1aae850.sql` — audit 欄位
   - `approval_source text NOT NULL DEFAULT 'admin_rpc' CHECK IN ('admin_rpc','owner_directive')`
   - `approval_note text CHECK length <= 500`
   - 一致性 CHECK：`admin_rpc` → `approved_by IS NOT NULL`；`owner_directive` → `approved_by IS NULL` 且 `approval_note` 非空
   - `approve_expert_public_sample` 固定寫入 `'admin_rpc'` + `auth.uid()`
   - `admin_expert_public_sample_status` 回傳 source/note 供稽核；public RPC 仍不回這兩欄
   - 表為 0 rows，migration 對既有資料 no-op（safe）
2. `20260821204346_163f5904-31fc-4be7-94a5-7c0e3f77399f.sql` — `sample_normalize_text` + M1 v2 + `build_expert_public_sample` 改用 normalized 文字
3. `20260821204614_2edf3be2-4f73-4e30-a19e-3344cbfb5125.sql` — normalize 尾端換行修正（`btrim(t, E' \t\r\n')`）
4. `20260821204901_87ecd60a-a5ef-46a9-be7d-0e6d48f93c80.sql` — 價格語境視窗 8 → 16 字（同句第二個價格如「短履約價（950 或 1600）」的 1600 可被完整遮罩）

### Changed / new files
- `src/lib/sampleRedaction.ts`（rewrite：normalize + M1 v2 鏡像，僅提示，不決定核准）
- `src/pages/_expert/RealSampleCard.tsx`（plain text + `whitespace-pre-line`，無 `dangerouslySetInnerHTML`）
- `src/test/unit/sampleRedaction.v2.test.ts`（new，23 tests）
- `src/test/unit/expertPublicSample.audit.contract.test.ts`（new，19 tests）

### Privilege / provenance matrix（未變更、已再驗）
- `expert_public_samples`：anon/authenticated 無任何 grant；RLS enabled、0 policy；`service_role` ALL
- public RPC `get_expert_public_sample`：僅 6 欄（expert_name, expert_slug, week_start_taipei, sections, mask_level, updated_at）
- `sample_redact_m1` / `sample_normalize_text` / `build_expert_public_sample`：anon/authenticated `REVOKE EXECUTE`
- 所有本輪函數 `SET search_path = pg_catalog, public, pg_temp`
- provenance：client 只能傳 `_expert_id, _week_start, _selections`；原文由 server 端讀取
- `source_content_hash` 仍 hash **raw exact source**；`sections.text` 存 normalized + M1 redacted plain text
- 未新增任何 owner_directive 永久繞過 RPC

### Read-only dry-run（權威 DB 規則等價）— 8 段最終選定，全部 residual = 0
| slug | field | new sha16 | len | price/qty/ratio masks | residual(tag/PII/price/qty/ratio/numeric) |
|---|---|---|---|---|---|
| sharkgu | overall_summary | 8d6533fd8fda3fc4 | 168 | 0/0/0 | 0/0/0/0/0/0 |
| sharkgu | overall_summary | 211a62798a370ad5 | 108 | 0/0/0 | 0/0/0/0/0/0 |
| master-zhou | overall_summary | 9c03fbe170fc2102 | 173 | 0/0/0 | 0/0/0/0/0/0 |
| master-zhou | overall_summary | b6498b8592188fe0 | 108 | 0/0/0 | 0/0/0/0/0/0 |
| master-brcto | overall_summary | f1f79562fb2800d8 | 101 | 0/0/0 | 0/0/0/0/0/0 |
| master-brcto | overall_summary | 840955044dd37348 | 71 | 0/0/0 | 0/0/0/0/0/0 |
| master-lever | overall_summary | a368a416177480e9 | 147 | 2/0/1 | 0/0/0/0/0/0 |
| master-lever | learning_points | 81422f1828343764 | 58 | 0/0/0 | 0/0/0/0/0/0 |

對照組：brcto B1（權證復盤）在新規則下 `fail_reason = future_instruction`、masked 輸出為空 → fail closed 正常。

### Tests / commands
- `bunx vitest run src/test/unit/sampleRedaction.v2.test.ts` → 23 passed
- `bunx vitest run src/test/unit/expertPublicSample.audit.contract.test.ts` → 19 passed
- `bunx vitest run`（full）→ **244 files（242 passed / 2 skipped）、3040 tests：3032 passed / 8 skipped**
- `bunx tsgo --noEmit` → exit 0
- `bun run build` → success

### 仍未完成（PARTIAL）
- 尚未寫入任何 approved 樣本（本輪禁止 INSERT/UPDATE）
- owner-directed bootstrap data transaction 未執行
