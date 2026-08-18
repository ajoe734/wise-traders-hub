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
