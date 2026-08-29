# HOLDINGS_MANUAL_ENTRY_BLOCKERS — B1–B4 修復計畫（Plan only，本輪 0 mutation）

稽核基準：HEAD `8784f8cc6`；ACL baseline blob `c62a3290b`。

---

## B3 — reload 保序（真正修，DB migration）

### 現況（已證）
- 寫入 `src/pages/FreeCheckup.jsx:891-926` `saveTradeLogToCloud()`：`delete .eq(user_id)` → 整批 `insert(rows)`，不帶任何序號。
- 讀取 `src/hooks/useFreeCheckupBootstrap.js:259-263`：`order('created_at', desc).order('id', desc)`。
- 同批 insert 的 `created_at` 幾乎相同（同一 statement 內 `now()` 相同），tie-break 落到 `gen_random_uuid()` → reload 後順序隨機。這是 B3 根因，無法靠客端修。

### 資料表現況
`public.checkup_trade_memos(id uuid pk default gen_random_uuid(), created_at timestamptz not null default now(), trade_date text, trade_time text, action text, code text, name text, qty numeric, price numeric, qa jsonb default '[]', user_id uuid not null)`；RLS 四條 policy 皆 `user_id = auth.uid()`（`20260412104335`）。

### Migration（單一檔，Lovable Cloud 原生）
檔名：`supabase/migrations/<ts>_checkup_trade_memos_sort_index.sql`

```sql
-- 1) 新欄位：可為 NULL 起步，舊 writer 不會失敗
ALTER TABLE public.checkup_trade_memos
  ADD COLUMN IF NOT EXISTS sort_index integer;

-- 2) per-user backfill：以目前「可觀測順序」created_at DESC, id DESC 產生 0-based 序號
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC, id DESC
         ) - 1 AS rn
  FROM public.checkup_trade_memos
)
UPDATE public.checkup_trade_memos t
SET sort_index = r.rn
FROM ranked r
WHERE t.id = r.id AND t.sort_index IS DISTINCT FROM r.rn;

-- 3) 預設值 + NOT NULL（backfill 後才收斂；default 讓舊 writer 仍可 insert）
ALTER TABLE public.checkup_trade_memos ALTER COLUMN sort_index SET DEFAULT 0;
ALTER TABLE public.checkup_trade_memos ALTER COLUMN sort_index SET NOT NULL;

-- 4) 只做非負檢查，不做唯一性（舊 writer 全 0 也必須合法）
ALTER TABLE public.checkup_trade_memos
  ADD CONSTRAINT checkup_trade_memos_sort_index_nonneg CHECK (sort_index >= 0);

-- 5) 讀取路徑索引
CREATE INDEX IF NOT EXISTS idx_checkup_trade_memos_user_sort
  ON public.checkup_trade_memos (user_id, sort_index, created_at DESC, id DESC);
```

- RLS：不變（不 DROP/CREATE 任何 policy）。GRANT：不變（既有表，非 CREATE TABLE）。
- 不刪任何 row、不加 unique constraint（避免舊 writer 或部分寫入衝突失敗）。
- Rollback：`DROP INDEX IF EXISTS public.idx_checkup_trade_memos_user_sort; ALTER TABLE public.checkup_trade_memos DROP CONSTRAINT IF EXISTS checkup_trade_memos_sort_index_nonneg; ALTER TABLE public.checkup_trade_memos DROP COLUMN IF EXISTS sort_index;` — 純加法，回滾不影響使用者內容。

### 讀寫 consumer（窮舉）
| 檔案 | 動作 | 變更 |
|---|---|---|
| `src/pages/FreeCheckup.jsx` `saveTradeLogToCloud` | insert | 每列加 `sort_index: idx`（`logs.map((l, idx) => ...)`，即 tradeLog array index） |
| `src/hooks/useFreeCheckupBootstrap.js` | select | `.order('sort_index', {ascending:true}).order('created_at',{ascending:false}).order('id',{ascending:false})`；client 端再做 deterministic 穩定排序 fallback（同 sort_index 時以 created_at DESC、id DESC 決勝），legacy 全 0 時等同舊行為 |
| `src/integrations/supabase/types.ts` | 型別 | migration 後自動重生 |
| `supabase/functions/account-link-consume/index.ts` | 整表搬移（table name list） | 無需改（`select *` / re-insert 帶欄位） |
| `supabase/functions/admin-account-force-merge/index.ts` | 同上 | 無需改 |

`sort_index` 只存在 DB 列與 hydration 排序，**不進 `qa`**、不進 tradeLog row contract 的 12 keys。

---

## B2 — 補齊核准的 exact 5 tests
現況：僅有 `src/test/unit/manual-trade-entry.test.ts`、`src/test/unit/stock-code-universe.test.ts`、`src/test/integration/manual-trade-single-pipeline.test.tsx`。

- 保留 T1/T2 兩檔。
- `git mv src/test/integration/manual-trade-single-pipeline.test.tsx src/test/integration/manual-trade-pipeline.test.tsx`（T4），並補：manual + OCR 共用同一 `parsed`/`applyCorrections`、preview 內 delete/edit 後 replay 結果一致。
- 新增 `src/test/unit/manual-trade-form.test.tsx`（T3）：code→name race（先改 code 後回填 name 不得覆蓋新值 / 舊回應丟棄）、錯誤僅在按下送出後顯示、TW `step=1` 與 US `step=any`（小數）輸入規則、demo 模式送出 0 mutation。
- 新增 `src/test/integration/trade-log-hydration.test.ts`（T5）：同 `created_at` + 亂序 UUID 仍依 `sort_index` 還原原順序、legacy（全 `sort_index=0`）走 created_at/id fallback、reload→delete→replay 後序號重寫仍保序。

## B1 — `src/checkup/modules/tradeIO/free.ts`
`ManualTradeForm` 的唯一實際 consumer 是 `src/checkup/components/freecheckup/TradeTab.jsx:6`，走**相對路徑直接 import**，不經 barrel；`FreeCheckup.jsx` 只 lazy 取 `LogTab/TradeTab/TradeUploadModal/BatchParsePanel`。→ barrel export 無 consumer，**移除該行**（檔案清單不擴張，`free.ts` 本就已在本輪異動清單內，並同步 `checkup-free-surface-barrel.test.ts` 期望）。

## B4 — 全量 Vitest 改寫 tracked ACL 的 call chain
Chain：`npx vitest run` → `src/test/unit/acl25-generator.test.ts:29` `execFileSync('python3', ['db/r1/p/build_acl25.py','--check'])` → `build_acl25.py` 無條件 `write_text`：L355 `acl-25.json`、L575 `095_acl25_verify.sql`、L639 `acl-25.md`（`--check` 只影響 L687 的 exit code，不影響寫檔）。`generated_at` 每跑必變 → tracked diff。

修法：
1. `build_acl25.py` 新增 `--out-dir <path>`（預設 = `db/r1/p`）；所有 `write_text` 改寫入 out-dir。
2. `acl25-generator.test.ts` 改為 `--check --out-dir <mkdtemp>`，把產出與 tracked 檔用既有 `stable()` 正規化後比對 hash，**永不寫 tracked**。
3. `package.json` 新增 `"acl25:generate": "python3 db/r1/p/build_acl25.py"`（唯一可更新 tracked 的明確命令）與 `"check:acl-clean": "git diff --quiet -- db/r1/p/acl-25.json db/r1/p/acl-25.md"`。
4. 新增 guard `src/test/unit/acl25-no-write-guard.test.ts`：記錄兩檔 mtime+sha，跑完 generator test 後必須完全不變（含 `generated_at` 行，不做忽略）。
5. 還原兩檔到 `c62a3290b` exact blob：`git checkout c62a3290b -- db/r1/p/acl-25.json db/r1/p/acl-25.md`（不 commit 前先驗 `git diff --quiet` exit 0）。

---

## 變更檔案清單
新增：`supabase/migrations/<ts>_checkup_trade_memos_sort_index.sql`、`src/test/unit/manual-trade-form.test.tsx`、`src/test/integration/trade-log-hydration.test.ts`、`src/test/unit/acl25-no-write-guard.test.ts`
改動：`src/pages/FreeCheckup.jsx`、`src/hooks/useFreeCheckupBootstrap.js`、`src/checkup/modules/tradeIO/free.ts`、`src/test/unit/checkup-free-surface-barrel.test.ts`、`db/r1/p/build_acl25.py`、`src/test/unit/acl25-generator.test.ts`、`package.json`
改名：`manual-trade-single-pipeline.test.tsx` → `src/test/integration/manual-trade-pipeline.test.tsx`
還原：`db/r1/p/acl-25.json`、`db/r1/p/acl-25.md`
自動重生：`src/integrations/supabase/types.ts`

## Migration 風險
- 大表 `UPDATE` 全掃一次（單次、可接受）；`SET NOT NULL` 需 backfill 完成，故順序不可調換。
- 舊 bundle 使用者在 migration 後仍能寫入（default 0）→ 其資料 hydration 走 fallback，不報錯、不遺失。
- 無 unique constraint，故重複 sort_index 不會讓舊 writer 失敗。

## 部署 / 回滾順序
1. migration（先）→ 2. types 重生 → 3. 前端 code 上線 → 4. 觀察。
回滾：先回前端 revision（新版依賴欄位，但欄位保留亦相容）→ 必要時才執行上方 rollback SQL。

## Gates
`npx vitest run <5 支 selected>` exit 0 → full `npx vitest run` exit 0 → `npm run build` → `tsgo`/typecheck → `npm run typecheck:edge:chips` → `npm run check:module-boundaries` → `npx playwright test e2e/holdings-bsr-unavailable.spec.ts` → `npm run check:acl-clean`（full Vitest 後 `git diff --quiet` exit 0）→ BSR gate 無 regression。

## Hosted 驗收（依序）
1 檔手動新增 → reload 保序 → delete 一列後 reload 保序 → 31 檔（含 legacy 混合）→ chips `[30,1]` 分批 → 390x844 版面無溢出 → 「清除所有資料」回 baseline（`checkup_storage` 9 key 空、`checkup_trade_memos` 0 列）。
