# /expert/:slug 真實週記範例 — Revised Plan v2（唯讀稽核完成，尚未執行）

本輪仍未改任何 code / DB / RLS / RPC / 資料，未 deploy、未 Publish。以下修正你點出的 7 項矛盾。

---

## 0. 稽核修正：active mentor 集合（不沿用先前 5 位）

`experts` 全表實測（role/status）：

| status | slug |
|---|---|
| **active mentor（本功能範圍，5 位）** | sharkgu、master-brcto、master-zhou、master-lever、master-brian |
| pending mentor（非 public，排除） | **benny**、ele、laofoye、mk、sean、vincent |
| suspended | lin-xiuqi(mentor)、zhao-pengbo(advisor) |
| advisor | 僅 zhao-pengbo（suspended）→ advisor 本功能不納入 |

**benny = `status='pending'`，目前不是 public active**（`get_public_experts_list` 也只回 5 位），故**不納入**。若日後轉 active，須另行 admin 核准才會出現範例。

## 0b. Candidate manifest（每位 1 週；未貼原文）

規則：只取 `status='published'`、週起 ≤ 2026-08-03（已過至少一完整公開週期，今日 Taipei 2026-08-22）、段落覆蓋最佳者。hash = SHA-256 前 16 hex（`sha256(convert_to(段落串接,'UTF8'))`）。

| slug | candidate week (Taipei 週一) | rows | overall/summary/detail/risk/learn | chars | PII hit rows | 數量價格樣式 rows | 未來指令樣式 rows | SHA-256 prefix | 選擇理由 |
|---|---|---|---|---|---|---|---|---|---|
| sharkgu | 2026-07-20 | 6 | 3/4/3/1/1 | 1266 | 0 | 0 | 3 | `ded234a7d130f17a` | 五段皆有、字數充足、PII 0 |
| master-zhou | 2026-08-03 | 4 | 4/4/1/0/0 | 855 | 0 | 0 | 2 | `33eb49ef8afd46be` | 避開 07-06/07-13（各 1 列 PII 命中） |
| master-brcto | 2026-08-03 | 5 | 3/5/3/0/0 | 634 | 0 | 3 | 3 | `65c682e230291235` | 該老師唯一同時具 detail 的較新週 |
| master-lever | 2026-07-27 | 3 | 1/3/3/3/3 | 1051 | 0 | 2 | 1 | `609787824c2b9ae9` | **唯一一週但段落最完整 → 採用，不顯示 empty** |
| master-brian | — | 0 | — | 0 | — | — | — | — | 全表 0 列 → 唯一 empty |

M1 掃描結論：**四位候選 PII（email/URL/line.me/09xxxxxxxx/+886）皆 0**；但 brcto／lever 有「數量價格樣式」命中、四位皆有「未來指令樣式」命中 → 依 §4 fail-closed 規則，這些列**不會自動核准**，必須在 admin 預覽逐段調整（改選段落或改週次），無法通過就不核准，該老師顯示「目前尚無公開範例」。因此本 manifest 是**候選**，不是既定結果。

初始核准**不用 migration seed**：Preview 中以 company_admin 帳號進後台逐位執行 approve，`approved_by/at` 由 RPC 從 `auth.uid()` 寫入（不接受 client 傳入）。

---

## 1. 公開讀取（修正 E2）

- `public.expert_public_samples`：**anon / authenticated 零 table grant**（不 GRANT SELECT）。只 `GRANT ALL TO service_role`。RLS 仍開，policy 只給 company_admin 讀寫（後台預覽/撤回走 RLS）。
- 公開讀取唯一入口：

```sql
create function public.get_expert_public_sample(_slug text)
returns table (
  expert_name text,
  expert_slug text,
  week_start_taipei date,
  sections jsonb,     -- [{key,label,text}]，已遮罩
  mask_level text,
  updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select e.name, e.slug, s.week_start_taipei, s.sections, s.mask_level, s.updated_at
  from expert_public_samples s join experts e on e.id = s.expert_id
  where e.slug = _slug and e.status = 'active' and e.role = 'mentor'
    and s.status = 'approved'
  limit 1
$$;
revoke all on function public.get_expert_public_sample(text) from public;
grant execute on function public.get_expert_public_sample(text) to anon, authenticated;
```

- 絕不回 `source_signal_ids`、`approved_by`、`source_content_hash`、`status`、`expert_id`。
- **為何比 table grant 權限更小**：table grant 是「整張表所有欄位」授權，RLS 只過濾 row 不過濾 column，內部欄位一律外露；此 RPC 是固定 column list + 固定 predicate + `limit 1` 的單一投影，anon 沒有任何 base-table 權限，也無法用 PostgREST `select=*`／`order`／`or=` 對該表做任意查詢或側信道枚舉。
- Contract tests：`has_function_privilege('public',...)=false`、`anon=true`；RPC 回傳 key 集合快照（多一個 key 即 fail）；anon 對 `expert_public_samples` 直查 → permission denied。

## 2. 漂移處理（移除假功能）

- Snapshot **immutable**：核准當下把遮罩後文字複製進 `sections`，公開內容永不隨 source 變動。
- `source_content_hash` = SHA-256 hex（不是 md5-12），**只給後台**。
- 後台 readonly drift badge：admin 開啟管理頁時重算來源 hash 比對，不符 → 顯示「來源已變更，需人工重審」。
- **明確定義**：偵測到 drift **不自動撤回**，已核准 snapshot 維持公開（因為它是已核准、已遮罩的固定副本，與 source 現況無關）；撤回由 admin 手動執行。本輪**不承諾 server-side 自動撤回**（`expert_signals` 上不新增 trigger — no-touch），此限制會誠實寫進 receipt。

## 3. 核准流程（單一 transactional RPC）

```sql
approve_expert_public_sample(_expert_id uuid, _week_start date, _sections jsonb, _source_ids uuid[], _mask_level text, _source_hash text)
revoke_expert_public_sample(_expert_id uuid)
```
兩者 `security definer` + `set search_path=public` + `revoke all from public` + `grant execute to authenticated`，函數第一行 `if not has_role(auth.uid(),'company_admin') then raise exception ...`。

單一交易內：驗 company_admin → 驗 expert `role='mentor' and status='active'` → 驗 `_source_ids` 全部屬該 expert、`status='published'`、`published_at` 落在 `_week_start` 的 Taipei 週且已過公開時點 → server 端重跑 PII/敏感 regex gate（client 送的遮罩結果會被重新驗，命中即 raise）→ 重算 `_source_hash` 比對 → `update ... set status='revoked'` 舊列 → `insert` 新列（`approved_by=auth.uid()`, `approved_at=now()`）。

- 不使用 service key in client；不改 `expert_signals` RLS/grants。
- 併發：`CREATE UNIQUE INDEX expert_public_samples_one_approved ON public.expert_public_samples (expert_id) WHERE status = 'approved';` 兩個並行核准 → 其一 unique violation，交易回滾（測試涵蓋）。

## 4. M1 deterministic redaction contract

單一實作 `src/lib/sampleRedaction.ts`（純函式，前後端規則同源，DB RPC 以同義 regex 再驗一次）：

| 類別 | 偵測 | 動作 |
|---|---|---|
| email | `[\w.+-]+@[\w-]+\.[\w.]{2,}` | 整段 fail-closed（不可核准） |
| 電話 | `09\d{8}`、`\+886\d+`、`0[2-8]-?\d{6,8}` | fail-closed |
| LINE / URL | `https?://`、`line\.me`、`@[A-Za-z0-9_]{4,}`、`t\.me` | fail-closed |
| 人名樣式 | 連續中文姓名 + 稱謂（老師/先生/小姐/總）、非該老師本人 | fail-closed |
| 價格 | `\d+(\.\d+)?\s*(元|塊|美元|USD|NT\$)`、`價位?\s*\d` | 遮罩為 `［價格已隱藏］` |
| 數量 | `\d+\s*(張|口|股|部位|單位)` | 遮罩為 `［數量已隱藏］` |
| 部位比例 | `\d+(\.\d+)?\s*%`、`(成|全倉|半倉)` | 遮罩為 `［比例已隱藏］` |
| 未來操作指令 | `(明天|下週|下周|接下來).{0,12}(買|賣|進場|出場|加碼|減碼|停損|目標價)` | fail-closed |
| 其他不確定命中 | 任何 regex 命中但無法歸類 | **fail closed，不可核准** |

- 保留老師句型，**不 AI 改寫、不跨筆拼湊**；每 section 只來自單一 source 欄位。
- 上限：每 section ≤ 1200 字元（超過截斷 + 「查看範例」展開，展開仍是同一段截斷後文字），`sections` 總 payload ≤ 8 KB，最多 4 段。
- 渲染一律 plain text（`{text}`），**禁用 `dangerouslySetInnerHTML`**；標的代號原樣保留（M1 定義），法務可於後台切 M0/M2。

## 5. Exact files

新增：
- `supabase/migrations/<ts>_expert_public_samples.sql`（table + unique index + RLS + grants + 3 支函數）
- `src/lib/sampleRedaction.ts`
- `src/hooks/useExpertPublicSample.ts`
- `src/pages/_expert/RealSampleCard.tsx`
- `src/pages/admin/_signals/PublicSampleDialog.tsx`
- `docs/funnel/expert-public-sample-receipt.md`（**只新增此 receipt，不動 `docs/funnel/v2.1-receipt.md`**）

修改：
- `src/pages/ExpertProfile.tsx:302`（`SampleStructureCard` → `RealSampleCard`）
- `src/pages/_expert/SampleStructureCard.tsx`（刪除或降級為 fallback）
- `src/pages/admin/Signals.tsx`（**exact**：`/admin/:expertSlug/signals` 的週次列表頁，`src/App.tsx:405`；核准入口掛此頁，開 `PublicSampleDialog`。編輯器 `src/pages/admin/SignalEditor.tsx`（`:406-407` new/edit，寫入走 `save_signal_batch`）**不改**）
- `src/lib/complianceCopy.ts`（範例卡標籤與 fail-closed 文案）

Tests：`src/test/unit/sampleRedaction.test.ts`、`src/test/unit/expert-public-sample.contract.test.ts`、`src/test/integration/expert-public-sample-rls.test.ts`、`e2e/expert-public-sample.spec.ts`。

No-touch：`expert_signals` RLS/grants/trigger、`get_expert_detail_bundle`、`save_signal_batch`、`journalRepository`（含 Deno 鏡像）、`trade_records`、cron、edge functions、`src/integrations/supabase/*`、既有 v2.1 receipt。

## 6. UI / a11y / analytics

Mobile 單欄、段落 h3、Radix Collapsible（`aria-expanded`、keyboard 可達）、截斷 + 「查看範例」。標示：老師名、歷史週次 `YYYY/MM/DD`、「已公開歷史範例」、「非即時建議」。三態 fail-closed：未核准/無資料→「目前尚無公開範例」；錯誤→「資料暫時無法取得」；**永不以他人內容補位**。事件：`view_weekly_sample`、`expand_weekly_sample`、`sample_unavailable{reason}`。

## 7. 驗收

1. logged-out `/expert/:slug` network：`expert_signals`/`trade_records`/`expert_public_samples` 請求數 = 0；只有 `rpc/get_expert_public_sample`。
2. RPC response schema snapshot（欄位集合固定，含禁出現欄位 0）。
3. fail-closed 矩陣：任意 slug、SQL-like slug（`' or 1=1--`）、pending/suspended 老師、advisor、draft(`pending`)、revoked、cross-teacher → 全 0 row。
4. XSS payload 以 literal text 呈現（DOM 無 script node）。
5. 非 company_admin 呼叫 approve/revoke → exception；併發雙核准 → unique violation + rollback。
6. 真實 Preview readback：5 位 active mentor 全查，master-brian 顯示「目前尚無公開範例」。
7. 390 / 380 / 560 / 1280 無溢位；keyboard + `aria-expanded`；console 0、4xx/5xx 0。
8. 迴歸 smoke：checkout/UTM 保留、/experts、/pricing、/holding-checkup。
9. full regression + `tsgo --noEmit` + `vite build`。
10. Receipt：sanitized manifest、SHA-256（各 changed file + candidate week）、限制聲明（drift 不自動撤回）。
11. Preview only，不 deploy、不 Publish。Rollback：`revoke execute` 三支函數 → `drop function` → `drop table expert_public_samples` → revert 前端；base 資料零影響。

### 待裁決
1. 遮罩層級 M0 / **M1（建議）** / M2。
2. 「未來指令樣式」命中列：改選段落／改週次／整週不核准 — 傾向何者？
3. benny 轉 active 後是否自動納入候選（仍需人工核准）。
