# /expert/:slug 真實週記範例 — Plan v3（delta，尚未執行）

僅列相對 v2 的修改；v2 其餘內容（candidate manifest、UI、驗收、no-touch、rollback）不變。仍未改任何 code/DB，未 deploy、未 Publish。

---

## A. Provenance：client 不得傳文字（取代 v2 §3 簽名）

```sql
-- client 只能指名「哪一列的哪一欄」，永遠不能送文字
create function public.approve_expert_public_sample(
  _expert_id  uuid,
  _week_start date,
  _selections jsonb   -- [{"signal_id":uuid,"source_field":text}] 2..4 項
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$ ... $$;

create function public.revoke_expert_public_sample(_expert_id uuid) returns void ...;
create function public.admin_expert_public_sample_status(_expert_id uuid)
  returns table (week_start_taipei date, status text, mask_level text,
                 source_content_hash text, source_drifted boolean,
                 approved_by uuid, approved_at timestamptz, section_count int) ...;
```

`mask_level` 不是參數：**本輪伺服器端硬編 `'M1'`**。

Server 交易內固定順序（client 無任何介入點）：

1. `auth.uid()` → `public.has_role(auth.uid(),'company_admin')`；`public.experts` 驗 `role='mentor' AND status='active'`。
2. `_selections` 結構驗證：陣列長度 2..4；每項 key 僅 `signal_id`/`source_field`；`source_field` allowlist = `reason_summary, reason_detail, risk_notes, learning_points, overall_summary`；**同一 signal_id 可出現多次但 (signal_id, source_field) 必須唯一**（同筆不同欄允許，同筆同欄重複 → raise）。
3. 依 signal_id 從 `public.expert_signals` 取原文（server 端 SELECT，非 client 傳入）：驗 `expert_id = _expert_id`、`status='published'`、`published_at` 落於 `_week_start` 的 Taipei 週、該週已完整結束且已過公開時點；任一不符 → raise。
4. 取出的 exact text 非空（trim 後長度 > 0），否則 raise。
5. Server deterministic M1 redaction（§4 contract 的 SQL 實作）：`未來操作指令 / email / phone / LINE·URL / 人名樣式 / 無法歸類命中` → **raise（fail closed）**；`價格 / 數量 / 比例` → 以固定字串遮罩。無 AI、無跨列拼接：**一個 section = 一個 (signal_id, source_field)**。
6. `sections` 由 server 組裝：`label` 來自 server 端 `source_field → 中文標籤` 固定映射（client 不得決定），`text` = 遮罩後原文；`source_signal_ids` 由 server 從 selections 推導；`source_content_hash` = server 對「未遮罩原文依 (signal_id, source_field) 排序串接」計 SHA-256。
7. Payload limits：每 section ≤ 1200 字元（超過 server 截斷並記 `truncated=true`）、sections ≤ 4、總 jsonb ≤ 8 KB，超過 → raise。
8. `update ... set status='revoked', revoked_at=now()` 舊 approved 列 → `insert` 新列（`approved_by=auth.uid()`, `approved_at=now()`, `mask_level='M1'`），受 partial unique index 保護。

Preview 用的唯讀 dry-run：`preview_expert_public_sample(_expert_id, _week_start, _selections)` 走**完全相同**的步驟 1–7，但不寫入，回傳每段 `pass/fail + fail_reason + 遮罩後文字`，供 admin 逐段檢視。gate 不通過只能「取消該段／換週次」，**UI 不提供編輯文字欄位**。

**Tamper tests**（皆須 raise 或 0 row）：
- `_selections` 夾帶 `text`/`label`/`sections`/`hash` 等額外 key → raise。
- signal_id 屬別位老師 / advisor / pending 老師 → raise（cross-teacher leak 0）。
- signal_id `status='pending'`（草稿）→ raise。
- 跨週混選（兩筆不同 Taipei week）→ raise。
- 未結束週次 / 未過公開時點 → raise。
- `source_field='instrument'`、`'price_hint'`、`'quantity'`、`';drop table'` → allowlist raise。
- 5 項 / 1 項 selections → raise。
- 同 (signal_id, source_field) 重複 → raise。
- 命中未來指令樣式 → raise；命中價格/數量 → 通過但 DB 內 `sections.text` 必含遮罩字串、且不含原始數字（斷言 regex）。
- 核准後直接 `UPDATE expert_signals` 改原文 → 公開 RPC 回傳的 `sections` **逐字不變**（immutable 證明），僅 admin status RPC 的 `source_drifted=true`。
- 對 approve RPC 以 anon / 一般 authenticated 呼叫 → permission/authz 失敗。

## B. Grants 一致化（取代 v2 §1 的矛盾敘述）

**選定：admin 也走 RPC，base table 對 anon 與 authenticated 皆零 grant。**

- `public.expert_public_samples`：`GRANT ALL TO service_role` 而已；**anon / authenticated 無任何 table 權限**。RLS 仍 `ENABLE`（縱深防禦），但不依賴它做讀取路徑。
- 公開讀：`get_expert_public_sample(_slug text)`（欄位如 v2，含 name/slug/week/sections/mask_level/updated_at）。
- 後台讀 metadata/drift：`admin_expert_public_sample_status(_expert_id uuid)`，內部 `has_role(auth.uid(),'company_admin')` gate。
- 後台預覽：`preview_expert_public_sample(...)`，同樣 admin gate。
- 因此 v2 中「後台靠 RLS 直讀」的敘述作廢。

## C. SECURITY DEFINER 加固（全部 5 支函數）

- 所有 relation/function 一律 schema-qualify（`public.expert_signals`、`public.has_role`、`pg_catalog.now()` 等）。
- `SET search_path = pg_catalog, public, pg_temp`（`pg_catalog` 置首，`pg_temp` 置尾，避免 temp object shadowing）。
- 建立後立即 `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` 再精準 `GRANT EXECUTE`：
  - `get_expert_public_sample` → `anon, authenticated`
  - `approve_/revoke_/preview_/admin_..._status` → `authenticated` only（內部 admin gate）
- 測試：`has_function_privilege('public'|'anon', ...)` 對 admin 函數為 false；`proconfig` 含預期 search_path；object-shadow 測試（在 `pg_temp` 建同名 `expert_signals` 後呼叫，結果不變）。

## D. 初始核准裁決（已定案，不再詢問）

- 遮罩層級固定 **M1**，不開放 M0/M2。
- **benny 不納入**（pending）；日後轉 active 也不自動公開，仍須人工核准。
- 只選「歷史／判斷」段落；任何命中未來指令樣式的段落**直接不選**；價格/數量走 deterministic 遮罩。
- 每位老師若最終湊不到 **2 段乾淨原文** → fail closed，不核准，前台顯示「目前尚無公開範例」。master-brian 恆為 empty。
- **禁止 admin 手工改寫句子通過 gate**（UI 無文字編輯），只能取消該段或換候選週次。
- Candidate weeks 沿用 v2（sharkgu 2026-07-20、master-zhou 2026-08-03、master-brcto 2026-08-03、master-lever 2026-07-27）；Preview 內 approve 前必顯示每段 pass/fail，approve 後再做 readback。

## E. Files delta

- migration 增為 5 支函數（get / preview / approve / revoke / admin status）＋ table ＋ `CREATE UNIQUE INDEX ... (expert_id) WHERE status='approved'`。
- 新增 `src/hooks/useExpertSampleAdmin.ts`（呼叫 preview/approve/revoke/status RPC）。
- `src/lib/sampleRedaction.ts` 降級為**顯示用鏡像**（僅供 UI 標示，權威判定在 DB），並加一致性測試比對規則清單。
- 其餘 files / no-touch / rollback / 驗收同 v2，另加 A 節 tamper tests 與 C 節 privilege tests。

Preview only，不 deploy、不 Publish。
