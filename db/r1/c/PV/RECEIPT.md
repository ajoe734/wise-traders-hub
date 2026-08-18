# PV — public_expert_state_active 修復收據

## Clone 演練（全新 disposable，每座獨立 initdb/port）
| run | checks | failures |
|---|---|---|
| PV1-20260818T024716Z-12227 | 40 | 0 |
| PV2-20260818T024728Z-12567 | 40 | 0 |
| PV3-20260818T024732Z-12803 | 40 | 0 |

SQL verifier 每座 29/29 PASS（view 存在、security_invoker=on、欄位契約、SELECT-only grants、
base table RLS 仍啟用、173 signals / 82 trades / 5 老師覆蓋、anon/subscriber/owner/cross-tenant/
company_admin 正反案例、incomplete 降級只影響該老師、quantity=0 真零不被 gate、view 不可寫）。
rollback 後 catalog fingerprint 與 pre-migration 逐字元相同，資料列數未變（173|82）。

## Production（唯一寫入 = 已驗證 migration）
- migration 已套用；讀回：rows=13 ready=13 incomplete=0，reloptions={security_invoker=on}
- expert_signals=173、trade_records=82（與事故前 manifest 一致，0 筆變更）

## 前端語意修正
- `UNAVAILABLE_LABEL = '資料暫時無法取得'` + `isMaskedRow()`（`src/contracts/publicProjection.ts`）
- `UnrealizedTab`：遮蔽列的數量／進場價／現價／損益／報酬全部顯示該字串，狀態改「檢核中」，並加頂部提示
- 回歸 `src/test/unit/projection-gate-display.test.tsx` 4/4 PASS：42P01、無投影列、ready 顯示真值、真 0 顯示「0 股」

## Gate
- `scripts/check-schema-readiness.mjs`（`npm run check:schema-readiness`）：4/4 relation reachable，缺表即 exit 1

## 全量回歸
canonical runner：phase-A 2906 passed / 8 skipped，phase-B 9 passed，TOTAL 2923，RESULT PASS

---

## 2026-08-18 收尾（Clean runs + production 唯讀比對）

### 1. 端點硬編碼修正與驗證（無功能變更）
- 新增 `src/lib/supabaseEndpoint.ts`（`SUPABASE_BASE_URL` / `functionUrl`），取代 `shareUrl.ts`、4 個 Bsr company 頁、`NotificationLinkHarnessEntry.tsx` 的字面 project URL；`index.html` preconnect 改 `%VITE_SUPABASE_URL%`。
- build 修復：`shareUrl.ts:61` 殘留 `SUPABASE_URL` → `functionUrl(...)`；`tsgo --noEmit` exit 0。
- 契約測試 `src/test/unit/supabase-endpoint-contract.test.ts`（3）+ `trade-records-select-contract.test.ts`（2）= 5 passed。
- production env build：`/tmp/dist-prod/index.html` preconnect = production URL（env 正確代入，1 處，符合預期）。
- clone env build：harness PVE-08 / PVE-09 皆 PASS（dist 內 0 筆 production project ref）。

### 2/3. 兩座 clean fresh clone（完整 harness，含 PVE-09）
| run_id | ports (pg/auth/rest/gw/app) | checks | failures | e2e | rollback | destroyed | log sha256 |
|---|---|---|---|---|---|---|---|
| PVE1-20260818T043536Z-19395 | 56750/56751/56752/56753/56754 | 58 | 0 | 46/46 | PVE-11/12 PASS，0 rows changed (6\|7) | true | `96ae151bbe2e9b8f85268ef9784b8f75f4cf579207081343b81ba2dd0ac08a91` |
| PVE2-20260818T043538Z-19442 | 56850/56851/56852/56853/56854 | 58 | 0 | 46/46 | PVE-11/12 PASS，0 rows changed (6\|7) | true | `5898ade014caab59534798d6667466f702e64b4f21de318ba98b6343072ded91` |

- 兩座獨立 DB / process / ports，皆非 `PVE1-20260818T042317Z-11452`（該 run 因 PVE-09 失敗，已標記 SUPERSEDED，不作為 clean run）。
- ready baseline：E35 console=[] net=[]；E45 5xx=[]；E44 unexpected=[]；E46 負向僅刻意 DROP VIEW 的 404 資源噪音。
- artifacts：`db/r1/c/PV/artifacts/PVE{1,2}-*.log`。

### 4. Production 唯讀 canonical post manifest
canonicalization 還原：`wk = to_char(coalesce(published_at, created_at) AT TIME ZONE 'Asia/Taipei','IYYY-"W"IW')`，欄位與事故前一致。事故前檔案的同秒同時間列無決定性 tie-break，故另以 **canonID（依 id 排序）** 做 byte 級比對。

| 集合 | 事故前 | 事故後 | 判定 |
|---|---|---|---|
| expert_signals 原檔 sha256 | `6b8ac96ee00c3858bc4b439634c251c5ac9d995cbe562e10dbd036fe1f285a89` | 全量 175 列 canonID `9c34713a428a2a09a1d891c162a7f3d7e43fb19b2bc1669a786bbf573936a71f` | — |
| expert_signals canonID（173 基準列） | `5a0f44c868d016bac8090a1ea54e769b7ce3746bc10ed7615dcabbc0bf64749f` | `5a0f44c868d016bac8090a1ea54e769b7ce3746bc10ed7615dcabbc0bf64749f` | **EXACT MATCH（0 內容變更）** |
| trade_records 原檔 sha256 | `b261dba4884fd7cfe6b3fbcf09b6276e99930da643d0ab2b7f351a91a1883cc3` | 全量 83 列 canonID `90b2e9560fd4607ceb4b0324472097183c12b78c0cd0ca7bec3bafcbfb0cdc0c` | — |
| trade_records canonID（82 基準列） | `437bd3c28d6e39bf3fe7e2ccc86d3d148b5eafceb7ab22222d3adf0e3a4937e3` | `ebdc6d0a7afeb4fd98e957ea99b8f72524803a758fdb15e65ce4d1224f3851a2` | DIFF = 1 筆合法平倉 |

Sanitized delta（未回寫任何資料）：
- expert_signals：+2 列（sharkgu、2026-W34、pending、2026-08-18T03:10:03Z 與 03:15:12Z）；0 刪除；0 內容修改。
- trade_records：+1 列（sharkgu、2316 楠梓電、open、2026-08-18T03:15:12Z）；1 列狀態變更 `d73f5be4` open→closed（exit_price ''→254、pnl_percent -0.38→-4.51）。
- 兩者皆為事故後老師正常操作產生，非資料遺失。
- 覆蓋：173 基準 signals 全部具 content_md5；週次 2026-W19 ~ 2026-W34。
- artifacts：`db/r1/c/PV/artifacts/ES_post_canon.csv`（sha256 `5a0f44c8…`）、`TR_post_canon.csv`（sha256 `ebdc6d0a…`）。

### 5. Sanitized teacher mapping（production 唯讀）
| slug | 顯示名 | experts.status | signals | min week | max week |
|---|---|---|---|---|---|
| sharkgu | 彥愷 | active | 87 | 2026-W19 | 2026-W34 |
| master-zhou | 老周老周 | active | 36 | 2026-W25 | 2026-W33 |
| master-brcto | brcto | active | 35 | 2026-W25 | 2026-W33 |
| benny | Benny | **pending** | 14 | 2026-W30 | 2026-W33 |
| master-lever | 阿基米德投資學 | active | 3 | 2026-W31 | 2026-W31 |
| master-brian | 布萊恩投資分享 | active | **0** | — | — |
| 其他 7 位（ele / zhao-pengbo / laofoye / vincent / lin-xiuqi / sean / mk） | — | pending / suspended | 0 | — | — |

結論：**5 位有資料老師** = sharkgu / master-zhou / master-brcto / benny / master-lever。`benny` 有 14 筆但 `status=pending`，因此不在公開 `/experts` 名單 —— 這是既有狀態設計，非資料遺失。`master-brian` 為 `active` 且公開，但本來就 0 筆週記（無任何刪除跡證：0 removed rows）。

### 6. 來源歸屬與邊界
- **Production DB read-only**：本輪所有 manifest / mapping 皆為 `SELECT` / `\copy TO`，0 migration、0 DML、0 seed。
- **使用者提供之已登入 Chrome live read**：`/admin/*/signals` 各老師本週筆數與可展開內容，由使用者本人 session 觀測並轉述；非 agent 自行登入。先前「blocked by auth」敘述作廢。
- **Clone 自動 E2E**：PVE1/PVE2（上表），synthetic fixture，未使用任何 production 原文。
- exact production URL config evidence：`.env:5 VITE_SUPABASE_URL`（Lovable Cloud 後端），公開站點 `https://legendflow.tw`。
- 無 deploy、無 Publish、無前端部署。
