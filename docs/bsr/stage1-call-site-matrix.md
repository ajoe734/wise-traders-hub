# Stage 1 — 唯讀 call-site matrix（migration 前）

產出時間：2026-08-22 02:4x UTC（10:4x 台北）。本文件為唯讀稽核結果，產出時未修改任何 code/schema/RLS/RPC/cron/data。

## 1. 四支 missing RPC 的精確 call-site

| RPC | exact caller file:line | 部署中的 edge function | active cron / job | 可達條件 | 預期 caller role | Stage 1 納入？ |
|---|---|---|---|---|---|---|
| `public.bsr_admission_status()` | `supabase/functions/_shared/bsrAdmissionGate.ts:156`（`fetchAdmissionStatus`）；使用端 `tw-bsr-finmind-sync/index.ts:538`（worker）、`:422`（enqueue writer） | `tw-bsr-finmind-sync`（`config.toml:160`） | jobid 45 / 46 / 51 / 53 / 67 / 98 / 107 全部 active | 每次 worker 或 enqueue 請求「最前面」必呼叫，任何 mode 都會走到 | `service_role`（edge 用 service key 建 client） | **是**（必要） |
| `public.bsr_block_and_terminalize_claims(uuid,bigint[],timestamptz[],int[],text,jsonb)` | `supabase/functions/_shared/bsrAdmissionGate.ts:303` | `tw-bsr-finmind-sync` | 同上（worker lane） | 只有在 provider 回 terminal rejection（`finmind_admission_provider_plan_rejected`）時呼叫；gate 目前 closed → 本輪不會被觸發 | `service_role` | **是**（必要；gate 的 write 半邊） |
| `public.bsr_unblock_after_probe(int,text,jsonb,uuid)` | `supabase/functions/admin-bsr-admission/index.ts:119` | `admin-bsr-admission`（`config.toml:175`） | 無 cron；由 verified admin actor 手動呼叫 | probe 成功後才呼叫 | `service_role`（函式內先驗 admin actor） | **是** — 見 §1.1 |
| `public.exec_count()` | `supabase/functions/backfill-daily-snapshots/index.ts:203` | `backfill-daily-snapshots`（`config.toml:105`） | jobid 20 `backfill-daily-snapshots-auto-resume`，`*/5 * * * *`，active | 每次執行都會走到 | `service_role` | **否** — known debt，見 §2 |

### 1.1 `bsr_unblock_after_probe` 的裁決

`bsrAdmissionGate.ts` 只在**註解**（`:7`）提到它，實際 `.rpc()` 呼叫在 `admin-bsr-admission/index.ts:119`。
即便如此仍納入 Stage 1，理由是必要性而非出處：

- `admin-bsr-admission` 已部署（`config.toml` 有 entry），呼叫路徑是現行可達的。
- 它是 `bsr_block_and_terminalize_claims` 造成 `admission_blocked=true` 之後**唯一的合法逆向操作**。只補 block 不補 unblock，等於製造一個「關得起來、開不回去」的閘門。
- clone 排練（`db/r1/c/SB/sb_verify.sql`、`sb_edge_rehearsal.sh`）三支一直是同一組驗過的，拆開會讓 production 與已驗證組態不一致。

## 2. `exec_count` 唯讀確認（known debt，不修）

- **deployed / active**：是。`config.toml:105` 有 `[functions.backfill-daily-snapshots]`；cron jobid 20 每 5 分鐘 active 呼叫。
- **現行 OHLCV cron 會不會走到**：會。`index.ts:203` 在每次批次結束的「進度總覽」段落無條件執行。
- **實際影響**：呼叫寫成
  `const { data: summary } = await sb.rpc('exec_count', {} as any).select?.() ?? { data: null }`，
  只解構 `data`、丟棄 `error`，且 `summary` 之後從未被使用。PostgREST 找不到函式時回錯誤物件而非 throw，因此 `rows_inserted`、`knowledge_backfill_progress` 狀態流轉不受影響。
- **最近錯誤**：`public.function_run_logs` 對 `backfill-daily-snapshots` 無任何列（該函式不寫這張表），所以沒有可引用的 DB 端錯誤紀錄；唯一可觀察面是 edge log 的 404/400 雜訊。
- **登記位置**：`scripts/rpc-known-debt.json`（RPC / caller file:line / 原因 / 發現日期 2026-08-22 / scope owner）。全域 scanner 報告固定顯示 `debt=1`，任何新的未登記 missing 仍然 fail。

## 3. clone（Stage B 排練）vs production diff

| 物件 | clone `db/r1/c/SB/001_stage_b.sql` | production（2026-08-22 讀取） | Stage 1 動作 |
|---|---|---|---|
| `SCHEMA private_bsr` | 有 | **不存在**（`pg_class` 於該 namespace 0 個物件） | 建立 |
| `private_bsr.gate_state()` | 有 | 無 | 建立（`bsr_admission_status` 相依） |
| `private_bsr.gate_classify(boolean,jsonb)` | 有 | 無 | 建立（三支 wrapper 共同相依） |
| `private_bsr.gate_blocked()` | 有 | 無 | **不建**（無人呼叫，非必要） |
| `private_bsr.gate_explicit_open()` | 有 | 無 | **不建**（無人呼叫，非必要） |
| `private_bsr.assert_sanitized(jsonb,int)` | 有 | 無 | 建立（兩支 write wrapper 相依） |
| `public.bsr_admission_status()` | 有 | 無 | 建立 |
| `public.bsr_block_and_terminalize_claims(...)` | 有 | 無 | 建立 |
| `public.bsr_unblock_after_probe(...)` | 有 | 無 | 建立 |
| `public.tw_bsr_sync_queue_admission_gate()` + `trg_...` trigger | 有 | 無（`tw_bsr_sync_queue` 上只有 `trg_tw_bsr_sync_queue_updated`） | **不建**（本輪明令不建 trigger） |

相依資料表在 production 均已存在且欄位相符：
`tw_bsr_sync_config(key,config,version,updated_at,updated_by,note)`、
`tw_bsr_sync_queue(... id,status,started_at,attempts,last_error,finished_at,next_run_at,updated_at)`、
`audit_logs(actor_id,action,target_type,target_id,detail)`、
`tw_bsr_degrade_events(api_name,from_mode,to_mode,reason,detail)`。

## 4. 套用後的預期行為（不開閘、不改資料）

production `tw_bsr_sync_config.market_batch.config` 目前**沒有** `admission_blocked` 鍵：

```
{"enabled": true, "supported": false, "last_probe_outcome": "unsupported",
 "last_probe_error": "unsupported_plan:http_400:{...Your level is register...}", ...}
```

依 `gate_classify` 的 fail-closed 契約，缺鍵 → `blocked=true, reason=legacy_config_missing`。因此：

- worker（`index.ts:538`）在任何 claim / provider 呼叫**之前**就 `admission.allowed=false` 直接返回 → `claimed=0`、`provider_calls=0`。
- 差別只在 decision 從 `rpc_error / admission_status_rpc_error:...` 變成 deterministic 的 `blocked / legacy_config_missing`。
  註：不會出現 `unsupported_plan` 字樣，因為那是 provider probe 的分類；gate 未被顯式關閉過，所以是 legacy 缺鍵路徑。**不會**為了讓字串好看而去改 config 資料。
- enqueue 路徑（`index.ts:415-478`）在本輪**行為不變**：它只把 admission 當標籤寫進 outcome，實際阻擋是靠 trigger，而 trigger 本輪不建 → queue rows 不會因此增減。

## 5. 現況快照（migration 前）

- queue：`pending=548`（enqueued 2026-08-07 起，最後 updated 2026-08-21 07:02）、`failed=1572`、`done=8432`。
- kill switches：`chips_all=true`、`chips_interactive=true`、`chips_backfill=true`、`chips_keepwarm=false`（disabled_reason `finmind_bsr circuit open ≥ 2h`，2026-08-22 02:30）。
- `tw_bsr_sync_config.market_batch` version=7，`supported=false`，最後 probe 2026-08-17T13:30:58Z。
- `degrade:finmind` version=95，mode=normal。
- BSR 相關 cron 全部 active，本輪不動。
