# Build 1e Final Plan v4 — dependency slice（closure 修正為 9 functions + 12 relations）

v3 在 closure gate 正確 hard fail：`checkup_prefetch_universe` → `public.tw_bsr_eligibility(text)` → `public.stock_names`，兩個物件不在 v3 的 19 行 baseline。v4 只做一件事：把 closure 固定為真正的 9+12，其餘 v3 已批准內容逐字沿用。

## 1. Baseline：19 行逐字不變 + 追加 2 行 = 21 行

`supabase/tests/fixtures/bsr_slice_expected.tsv` 既有 8 個 header 註解行與 19 行資料行 **逐字不變**，只在檔尾語意位置追加下列兩行（fn 區塊維持字母序、rel 區塊維持字母序），並把 header 的 `format_version=1` 改為 `format_version=2  approved_in=Build1e Final Plan v4`（僅此一行 header 變更）：

```
fn	tw_bsr_eligibility	p_stock_id text	jsonb	s	true	search_path=public	postgres	7445f13e5ce9ce8e4d113dc47df074ae
rel	stock_names	8b4446cd0b920172e0faffd4369a9993bef430e9a3627b7fc624889a525909db
```

最終 21 行資料行邏輯內容（kind/name/hash 摘要，fn 欄位順序 = name, identity_args, returns, volatility, secdef, proconfig, owner, md5）：

fn 共 9：`bsr_backlog_metrics` a419d519…、`bsr_get_degrade_state` 9e6282f8…、`bsr_recovery_budget` eb9ee387…、`check_kill_switch` c36021af…、`checkup_prefetch_universe` cfcff927…、`expected_latest_bsr_date` 48ea387e…、`recover_quota_failed_bsr_jobs` 8a50211b…、`tw_bsr_eligibility` 7445f13e…、`tw_bsr_sync_queue_touch_updated` fe1a2aca…（前 8 行 md5/欄位與 v3 完全相同，逐字不動）。

rel 共 12：`checkup_storage`、`chips_prefetch_targets`、`data_source_refresh_logs`、`expert_signals`、`finmind_quota_pools`、`stock_names`、`system_kill_switches`、`trade_records`、`tw_bsr_sync_config`、`tw_bsr_sync_queue`、`tw_chip_fact`、`tw_market_holidays`（前 11 個 sha256 與 v3 逐字相同）。

`gen-bsr-slice-fixture.sh` **仍絕不可寫入或自動更新此 TSV**；本次追加是人工審核 + 本 Plan 批准。

## 2. `tw_bsr_eligibility(text)` production read-only metadata

- exact identity: `public.tw_bsr_eligibility(p_stock_id text)`；`regprocedure` = `tw_bsr_eligibility(text)`
- returns `jsonb`；volatility `s` (STABLE)；`prosecdef = true`（SECURITY DEFINER）
- `proconfig = {search_path=public}`；owner `postgres`
- md5(pg_get_functiondef) = `7445f13e5ce9ce8e4d113dc47df074ae`
- required role semantics：SECURITY DEFINER + owner postgres，slice 內以同一 owner 建立即可重現；本測試不改變其 ACL（ACL 收斂屬 Build1c 已完成範圍）
- source 分析：純 PL/pgSQL，控制流為 NULL/空字串檢查、regex `^[1-9][0-9]{3}$`、`^0[0-9]{3,5}$`，以及兩處 `SELECT … FROM public.stock_names WHERE symbol = p_stock_id LIMIT 1`。**唯一外部 relation = `public.stock_names`**；無 EXECUTE/dynamic SQL、無其他 function 呼叫（僅 builtin `btrim`、`jsonb_build_object`、regex 運算子）。

## 3. `stock_names` closure canonical manifest

受測語意實際只讀 `symbol`、`asset_class`，但 canonical fingerprint 依 v3 規則涵蓋全部 column shape：

| column | type | notnull | default |
|---|---|---|---|
| symbol | text | true | – |
| name | text | true | – |
| created_at | timestamptz | true | now() |
| currency | text | true | 'TWD'::text |
| market | text | false | – |
| asset_class | text | true | 'tw_stock'::text |

- PK：`stock_names_pkey PRIMARY KEY (symbol)`（同時是唯一 unique index，`WHERE symbol = …` 與 `LIMIT 1` 語意所需）
- CHECK：`stock_names_asset_class_check`（tw_stock/us_stock/crypto/us_option/us_future）、`stock_names_currency_check`（TWD/USD）——會決定 `unsupported_asset_type` 分支可測值域，必須納入
- FK：0；trigger（non-internal）：0；index 總數 1（即 PK，無 performance-only index 可混入）
- RLS：`relrowsecurity = true`（shape 之一；slice 內測試以 owner 身分執行）
- hash：沿用 v3 SHA-256 canonicalization（欄位序 attnum 的 name|type|notnull|default|identity::text|generated::text，加上排序後的 constraint defs、unique/PK index defs、trigger bindings），得 `8b4446cd0b920172e0faffd4369a9993bef430e9a3627b7fc624889a525909db`

## 4. Closure 重跑（production read-only catalog）

以 recursive `pg_depend` + prosrc 靜態交叉比對 + trigger binding 交叉比對重跑，最終 exact 物件集合 = 上述 9 functions + 12 relations。驗收門檻：unresolved function = 0、unresolved relation = 0、unqualified external object = 0、dynamic SQL = 0。**若出現第 22 個物件，立即停下並回到 Plan 模式重做，不得自行追加。**

## 5. 防假綠控制（v3 全數保留，擴到新兩物件）

- production actual vs pinned 21 行 baseline diff → 任何差異 hard fail（exit 2）
- normal `verify` / `test` 一律離線，只連本機 socket，禁止 production 連線
- Case A/B/C 各自獨立 rollback，逐案輸出 exact job ids / invocation / audit rows / churn
- behavior negative：期望失敗數必須非 0
- function drift negative：新增 case 必須能以竄改 `tw_bsr_eligibility` body 觸發 fail
- schema drift negative 六個 subcase：擴充涵蓋 `stock_names` 的 column drop/type change/notnull/default、PK/unique 移除、CHECK 移除、trigger 新增
- guard failures 非 0；cleanup 後 `/tmp` 與 ephemeral datadir 零殘留

## 6. 批准後 exact 執行順序與 acceptance 證據

1. `scripts/gen-bsr-slice-fixture.sh`（read-only，opt-in + project-ref guard）→ closure 必須列出 9+12，exit 0
2. `scripts/ephemeral-pg.sh up-slice` → 本機 socket，`current_database()` 非 production
3. `load-slice` → exit 0
4. `scripts/bsr-slice-verify.sh` → 21 行全對，exit 0
5. Case A / B / C → 各 exit 0，附 job/audit/churn 證據
6. negatives：function drift、schema drift ×6、behavior、guard → 每個都必須 **非 0** exit
7. `ephemeral-pg.sh down` + cleanup → 零殘留

全程 production 零寫入；不動 `supabase/migrations/`、Edge Functions、cron、queue 資料。`diagnose-migrations`（408 restore）**另列為 FAIL 技術債，不得併入 Build1e PASS**。

## 7. 只會新增/修改的檔案

- 修改：`supabase/tests/fixtures/bsr_slice_expected.tsv`（header format_version 行 + 追加 2 行）
- 修改：`scripts/bsr-slice-verify.sh`、`scripts/bsr-slice-closure-check.sh`、`scripts/gen-bsr-slice-fixture.sh`（承接 9+12 與新 negative subcases）
- 修改：`scripts/ephemeral-pg.sh`（slice 載入含新兩物件）
- 新增：slice 測試 case 中 `stock_names` 的最小 seed 與 drift fixtures

Approve 僅授權完成 Build1e dependency-slice 測試。**不授權 Build2，不授權手動觸發 job106/job107**；自然排程證據另行累積。
