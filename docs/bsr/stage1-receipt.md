# Stage 1 Receipt — BSR admission gate RPC 補回（production）

Scope：只補現行 deployed edge function 可達且必要的 gate RPC。
不 deploy frontend、不 Publish、不 toggle 旗標、不開閘、不 claim backlog、不做 provider capability call。

Call-site matrix：`docs/bsr/stage1-call-site-matrix.md`
Snapshots：`db/r1/c/S1/snapshot_pre.txt`、`db/r1/c/S1/snapshot_post.txt`

---

## 1. RED → GREEN

| 項目 | 套用前（RED） | 套用後（GREEN） |
| --- | --- | --- |
| `scripts/audit-rpc-in-migrations.mjs` | gate missing=2、global missing=3（`bsr_admission_status`、`bsr_block_and_terminalize_claims`、`bsr_unblock_after_probe`）+ debt=1 | `gate ... missing=0 (allowed=0)`；global OK；`debt=1`（顯性列印 `exec_count`） |
| `src/test/unit/rpcInMigrations.contract.test.ts` | FAIL | 7 passed |
| worker body | `rpc_error`（找不到函式，fail-closed） | `admission_gate_closed` / `decision=blocked` |

Gate 契約仍是 zero allowed missing（`forbidden_names` 禁止 gate 三支被寫進 known-debt manifest，寫了會直接丟例外）。

## 2. Migration

- exact name：`supabase/migrations/20260822024453_c57ec769-6af5-47b8-9b80-daadfcfcf545.sql`
- 建立物件（6）：
  - `private_bsr.gate_state()` — secdef，`search_path=pg_catalog, private_bsr`，md5(def)=`3cbdc55b288f6026e7cee0482e4459dd`
  - `private_bsr.gate_classify(boolean, jsonb)` — **INVOKER**（純函式不碰表，維持最小權限），`search_path=pg_catalog`，md5=`189ea2e74f3a62b07b4e5584c38368b6`
  - `private_bsr.assert_sanitized(jsonb, int)` — secdef，md5=`c46e030ac35bf9598b9bab3556682ae3`
  - `public.bsr_admission_status()` — secdef，md5=`a38e3dae68dfc1bcf465527ebb42bf2e`
  - `public.bsr_block_and_terminalize_claims(uuid, bigint[], timestamptz[], int[], text, jsonb)` — secdef，md5=`5a6aea7137b7adb189ef9bfbdbc297c1`
  - `public.bsr_unblock_after_probe(int, text, jsonb, uuid)` — secdef，md5=`addade28ffaf6a37a46f53e2666691d2`
- 明確排除：`private_bsr.gate_blocked()`、`private_bsr.gate_explicit_open()`、`public.tw_bsr_sync_queue_admission_gate()` 與其 trigger（無現行呼叫端）。
- Exact inverse rollback 逐字寫在 migration 檔頭（6 支 DROP FUNCTION + `DROP SCHEMA private_bsr`；不觸及任何資料列）。

### SECURITY DEFINER 逐支理由
- `gate_state`：呼叫端 service_role 對 `private_bsr` 無權限，gate 狀態必須以固定身分讀取。唯讀。
- `gate_classify`：**不是** definer。純 IMMUTABLE 判定，不需要提權。
- `assert_sanitized`：與 write wrapper 同身分，避免呼叫端以 search_path 置換掉 evidence denylist。
- `bsr_admission_status`：唯讀、零參數（無注入面），需跨 schema 讀 gate。
- `bsr_block_and_terminalize_claims`：需在單一交易內 `FOR UPDATE` 鎖 gate 列、寫 config、pairwise 條件更新 queue、寫 audit/degrade，原子性與稽核可信度要求固定身分。輸入硬性驗證：terminal_code 白名單單一值、三陣列 pairwise 等長、批次上限 500、evidence 必須 object 且過 denylist。
- `bsr_unblock_after_probe`：與上對稱；開閘另需 probe schema v1 + HTTP 200 + `sample_row_count>0` + `expected_version`/`nonce` 完全相符，stale/重放自然失敗。

## 3. Production readback（套用後實測）

```
bsr_admission_status              | anon=false | auth=false | svc=true
bsr_block_and_terminalize_claims  | anon=false | auth=false | svc=true
bsr_unblock_after_probe           | anon=false | auth=false | svc=true
private_bsr schema acl = {postgres=UC/postgres}
  anon_usage=false auth_usage=false svc_usage=false   ← private helper 永遠不經 PostgREST
private_bsr.* proacl = {postgres=X/postgres}（三支皆無 anon/authenticated/service_role）
owner=postgres（全部）；proconfig 全部有固定 search_path
```

註：`sandbox_exec_*` 出現在 public 三支的 ACL 是平台 sandbox 角色的既有 default privileges，非本 migration 授予；該角色在 psql 實測仍 `permission denied for function bsr_admission_status`。

## 4. 自然 worker 週期驗收（未人工觸發）

cron `tw-bsr-worker-weekend`（jobid 98，`*/10 * * * 6,0`）→ 02:50:00Z 自然觸發。

```
run_id     : 51966906-4f5a-44dd-9cba-97992b2d289d
request_id : net._http_response id=272194
HTTP       : 200
body       : {"ok":true,"note":"admission_gate_closed",
              "admission":{"decision":"blocked","blocked":true,
                           "reason":"legacy_config_missing",
                           "terminal_code":null,"blocked_at":null,"gate_version":7},
              "claimed":0,"processed":0,"provider_calls":0,"elapsed_ms":107}
```

decision 來源：`market_batch` config 缺 `admission_blocked` 鍵 → `gate_classify` 回 `legacy_config_missing` → fail-closed。符合 Stage 1 預期（rpc_error → deterministic blocked，claimed=0、provider_calls=0）。

## 5. Before / After 不變量

| 指標 | before (02:42Z) | after (02:51Z, 含一個自然週期) |
| --- | --- | --- |
| queue counts | done=8432 / failed=1572 / pending=548 | done=8432 / failed=1572 / pending=548 |
| queue rows md5 | `41bb160517c17f0f737d95c269f813b2` | `41bb160517c17f0f737d95c269f813b2` |
| `market_batch` | v=7 / md5=`dd747a45d3e46b2acc3f0c021bc269f8` | v=7 / md5=`dd747a45d3e46b2acc3f0c021bc269f8` |
| 其餘 8 個 sync_config key | 全部 md5 相同 | 全部 md5 相同 |
| queue triggers | `trg_tw_bsr_sync_queue_updated`（1） | `trg_tw_bsr_sync_queue_updated`（1，未新增 gate trigger） |
| 新 audit_logs `bsr_admission%` | — | 0 |
| 新 degrade_events | — | 0 |
| provider calls | — | 0 |

未觸發 rollback 條件（claimed=0、queue 未變、provider_calls=0）。

## 6. `exec_count` known debt 稽核

- caller：`supabase/functions/backfill-daily-snapshots/index.ts:203`（`.rpc('exec_count')`），migrations 中無定義。
- 與 BSR gate lane 無關（OHLCV / knowledge backfill lane），本輪明令不得順手修。
- 管理方式：`scripts/rpc-known-debt.json` 顯性 manifest（rpc / caller file:line / reason / discovered / scope_owner），scanner 每次印出 `debt=1` 與該筆明細，不靜默忽略；任何**新增** missing 仍直接 fail。
- gate 三支被列入 manifest 的 `forbidden_names`，無法被降級成技術債。

## 7. 測試檔

- `src/test/unit/rpcInMigrations.contract.test.ts`（7 passed）
- `supabase/tests/bsr_admission_gate_contract_test.sql`（secdef / search_path / service_role-only ACL 斷言）
- `supabase/tests/checkup_storage_universe_rls_test.sql`（authenticated 本人寫 `checkup_storage.data` → service_role 跑 `checkup_prefetch_universe` 讀得到；authenticated 執行 universe RPC 必須 `insufficient_privilege`；fixture 交易內 ROLLBACK；未 GRANT authenticated EXECUTE）

## 8. 狀態

Stage 1 = **DONE，等待審核**。閘門維持關閉，Stage 2（provider capability probe）未執行。
