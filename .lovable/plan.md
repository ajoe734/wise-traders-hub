## PR-10（第五版，最終定版）

### v4 再審 — 12 個新弱點與修正

| # | v4 漏洞 | v5 修正 |
|---|---|---|
| 1 | SQL container 測試只 apply `*finmind*.sql` 會缺跨檔依賴 | Apply **整個 `supabase/migrations/` 目錄**（filename 排序），才能建齊 `finmind_quota_pools`（在非 finmind-prefix migration）等前置表 |
| 2 | `FINMIND_ADMIT_LEGACY` rollback 假設 v1 RPC 還在 | **已驗證**：`20260725160922` / `162913` 兩支 v2 migration 未 `DROP FUNCTION finmind_admit`，v1 仍存在於 DB（`grep DROP FUNCTION.*finmind_admit` 空結果）。rollback 路徑可用；plan 明確記錄此前提，若未來刪 v1 須同步刪 flag |
| 3 | Golden fixture 「手工錄」沒說怎麼錄 | 新增 `scripts/record-guardian-golden.mjs`：對舊 chips-guardian inline 邏輯跑 6 組 input，dump 到 `__fixtures__/decisions.golden.json`。**先跑腳本 check-in fixture、再重構**；腳本本身 check-in 供未來門檻常數調整重錄 |
| 4 | Coalescer 副作用搬 caller 會被複製貼上 | 新增 helper `supabase/functions/_shared/coalesceDbHook.ts`：`makeInflightHook(supa, kind)` 回傳 `{onAcquire, onRelease}`，caller 一行接入。避免每個 caller reimplement DB 語法 |
| 5 | UI Badge test 綠但 hook 型別漏 `coalesced` 會靜默 undefined | plan 明確要求：先 `code--view src/checkup/hooks/useTwChipsDetail.ts` 確認 payload 型別已 include `coalesced?: boolean` 與 `_cache_meta.cache?: 'miss' \| 'coalesced' \| ...`；未 include 就先補型別，再寫 test |
| 6 | E2E stateful mock 併發亂序 | route handler 用**單調 counter 只在請求送達當下 ++**；兩次抽屜開啟之間 `await page.waitForResponse('**/tw-chips-detail**')` 序列化。避免第 2 次抽屜比第 1 次 response 先到 |
| 7 | SQL 測試 non-required 可能永遠不 promote = 裝飾 | **明訂晉升條件**：連續 3 週工作日 100% pass、無 flaky retry → 改 required；日期記在 runbook §5。若 6 週仍不穩，決定「移除或修好」，不留半殘 |
| 8 | Runbook rollback 沒說副作用 | 明寫：`FINMIND_ADMIT_LEGACY=1` → 走 v1 daily_budget，**token bucket / 借用 / SLO boost / `borrowed_from` ledger 全失效**，DataSourceHealth 面板會顯示異常空欄。這是換一組行為救急，不是無害還原 |
| 9 | Phase-3「明確不做」無條件 = 不會被觸發 | 每項改成**條件式 trigger**：<br>- Guardian → DB job：若 chips-guardian cron P95 冷啟 > 30s 觀察 2 週<br>- 自動 snapshot fixture：若手工錄一年內超過 5 次<br>- pgTAP：若 SQL 測試被 promote 成 required<br>- Coalescer 跨 isolate：若同股同秒重複上游呼叫日均 > 100 |
| 10 | `pr10-*` 檔名兩年後溯源難 | 改**領域前綴**：`chips-admission-adapter.test.ts` / `chips-guardian-golden.test.ts` / `chips-guardian-slo.test.ts` / `chips-guardian-upstream.test.ts` / `chips-coalesced-badge.test.tsx` / `chips-coalesce.spec.ts`（E2E）/ `requestCoalescer_test.ts`（Deno） |
| 11 | Guardian 常數若合理調整、fixture 未同步會爆 | plan 明訂：**任何 guardian 門檻常數 PR 必須同時**：(a) 重跑 `record-guardian-golden.mjs`、(b) 更新 runbook §2、(c) reviewer checklist 檢查兩者一致 |
| 12 | Coalescer hook 型別若強 sync，caller fire-and-forget error 會漏 | hook 型別定為 `() => void \| Promise<void>`；coalescer 內 `await Promise.resolve(hook()).catch(err => console.warn('[coalesce hook]', err))` |

---

### 一、檔案總覽（v5 定版）

**生產碼**
- `supabase/functions/_shared/guardianRules.ts`（新）— 純函式 `decideSloAdjustment` / `decideUpstreamThrottle`
- `supabase/functions/_shared/coalesceDbHook.ts`（新）— `makeInflightHook(supa, kind)`
- `supabase/functions/_shared/requestCoalescer.ts`（改）— hook 支援 sync/async、內部 catch
- `supabase/functions/_shared/finmindAdmission.ts`（改）— 加 `FINMIND_ADMIT_LEGACY` 分支、補 `{data:null,error:null}` 邊界
- `supabase/functions/chips-guardian/index.ts`（改）— 改呼 guardianRules
- `supabase/functions/tw-chips-detail/index.ts`（改）— 用 `makeInflightHook`
- `src/checkup/hooks/useTwChipsDetail.ts`（驗）— 型別 include `coalesced`、`_cache_meta.cache`（缺就補）
- `src/checkup/components/freecheckup/ChipsSection.tsx`（已完成，僅驗）

**Fixture / Script**
- `scripts/record-guardian-golden.mjs`（新，一次性 + 常數變更時重跑）
- `supabase/functions/chips-guardian/__fixtures__/decisions.golden.json`（新）

**測試**
- `src/test/unit/chips-admission-adapter.test.ts`
- `src/test/unit/chips-guardian-golden.test.ts`
- `src/test/unit/chips-guardian-slo.test.ts`
- `src/test/unit/chips-guardian-upstream.test.ts`
- `src/test/components/chips-coalesced-badge.test.tsx`
- `supabase/functions/_shared/requestCoalescer_test.ts`（Deno）
- `supabase/tests/finmind_admit_v2_test.sql`
- `e2e/chips-coalesce.spec.ts`

**CI**
- `.github/workflows/finmind-admit-sql-tests.yml`（新，non-required，postgres:15 container，apply 全 migrations 目錄）
- 掛新 vitest 檔到 `test.yml`
- 掛 Deno 檔到 `finmind-bsr-tests.yml`

**Docs**
- `docs/ops/chips-pipeline-runbook.md`：§2 coalesced/token bucket 指標、§3 golden fixture 排查、§4 rollback 副作用告示、§5 SQL 測試晉升條件與日期、§6 常數變更 checklist

---

### 二、執行順序（相依性最小化）

1. **驗證** `useTwChipsDetail` 型別（弱點 5）— 缺就補
2. 寫 `record-guardian-golden.mjs` → 產 fixture → check-in
3. 抽 `guardianRules.ts`、`coalesceDbHook.ts`；改 `requestCoalescer.ts`；改 `finmindAdmission.ts` 加 legacy flag 與邊界
4. 更新 chips-guardian、tw-chips-detail 呼叫端
5. 寫全部 Vitest / Deno 單元測試
6. 寫 UI badge 測試 + E2E（用 stateful counter + waitForResponse）
7. **平行**：建 SQL container workflow + `finmind_admit_v2_test.sql`（apply 整個 migrations 目錄）
8. Runbook 六節更新
9. 全綠後掛測試路徑到既有 workflows；SQL workflow 起始為 non-required

---

### 三、驗收（可勾選清單）

- [ ] `useTwChipsDetail` 回傳型別含 `coalesced?: boolean` 與 `_cache_meta.cache?`
- [ ] `record-guardian-golden.mjs` 可重跑產出**確定性** JSON（無時間戳、無隨機）
- [ ] `bunx vitest run src/test/unit/chips-*.test.ts src/test/components/chips-coalesced-badge.test.tsx` 全綠
- [ ] `deno test supabase/functions/_shared/requestCoalescer_test.ts` 全綠
- [ ] `bunx playwright test e2e/chips-coalesce.spec.ts` 綠（無 flaky retry）
- [ ] SQL container workflow 綠（non-required，起始日期記 runbook §5）
- [ ] `tsgo` 無新錯誤
- [ ] Runbook §2–§6 全部就位
- [ ] Guardian 原 inline 代碼刪除只在 golden fixture 綠燈 3 天後執行
- [ ] `FINMIND_ADMIT_LEGACY=1` 手動 smoke：edge function 本地 `supabase functions serve` 加 env 跑一次，確認走 v1 RPC 且 log 有 legacy 標記

---

### 四、明確排除（有條件才做，避免下輪再被追問）

- Guardian → DB job：**條件** chips-guardian cron P95 冷啟 > 30s 觀察 2 週
- Golden fixture 自動快照 mode：**條件** 手工錄 12 個月內 > 5 次
- pgTAP 正式框架：**條件** SQL container 測試被 promote 成 required
- Coalescer 跨 isolate advisory lock：**條件** 同股同秒重複上游呼叫日均 > 100

---

### 五、還有沒有漏？— v5 自我審視結論

- **CI 環境**：已用 postgres container 解，且 apply 全 migrations 避免缺依賴
- **Rollback**：已驗 v1 RPC 存在、已列副作用
- **Fixture 生命週期**：錄／更新／檢查三環節都有負責人與觸發條件
- **測試命名**：領域前綴，兩年後可搜
- **假設全部標記已驗**：SQL 依賴、v1 存在、hook 型別狀態都有 pre-check 步驟
- **副作用邊界**：coalescer hook `catch` 保護、DB 寫入 helper 化避免複製

若下一輪還能找到弱點，會在「未列入的隱含假設」層級（例如 postgres container 版本漂移、GitHub runner 時區、Deno 版本升級），這已屬環境治理而非本 PR 範疇。