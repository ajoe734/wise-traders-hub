## Step 5：Vitest 設定收斂 + Helper Catalog smoke test

Phase 3A.4 收尾的兩項 CP 值最高的補強，純測試/設定層，不動 production runtime。

---

### 1. Vitest exclude e2e（5 分鐘）

**問題**：`vitest run` 目前會掃到 `e2e/*.spec.ts`（Playwright 語法），產生 1 個 fail 的噪音檔，未來 unit fail 容易被淹沒。

**修改**：`vitest.config.ts`
- `test.exclude` 加入 `'e2e/**'`（保留現有 `'node_modules'`、`'dist'`）

驗證：`bunx vitest run` 不再出現 e2e 相關的 collect error / fail。

---

### 2. `useAppRuntimeHelperCatalog` smoke test（15 分鐘）

**問題**：Step 4 才剛抓到「import 漏掉 `holdingEventUtils`」這種 bug，這支 catalog 是所有 workflow / lifecycle hooks 的共用入口，沒有任何測試防線；下次再漏 import 又會雪崩。

**新增**：`src/test/unit/checkup-helper-catalog.test.ts`

涵蓋兩個 export 物件：
- `APP_RUNTIME_CORE_LIFECYCLE_HELPERS`（33 個 helpers）
- `APP_RUNTIME_WORKFLOW_HELPERS`（27 個 helpers）

每個物件斷言：
1. import 不丟 error（catch import-time 失敗，例如缺漏的 named import）
2. 物件本身是 plain object 且非空
3. 每一個 key 對應的 value 都是 `function` 且非 `undefined`（防止「export 名字打錯 → 變 undefined」）
4. 抽樣 1–2 個 helper 做最薄的行為呼叫（例如 `toSlashDate(new Date('2026/01/02'))` 回傳 `'2026/01/02'`、`createDefaultReviewForm()` 回傳 object）—— 確認真的可被呼叫，而不只是「是 function」。

**不做**的事：
- 不重測各 helper 的內部邏輯（那是各自 utils 的單元測試責任）
- 不 mock 任何 Zustand / Supabase（純函式 catalog，沒這些依賴）

驗證：
- `bunx vitest run src/test/unit/checkup-helper-catalog.test.ts` 全綠
- 故意把 catalog 中某個 import 註解掉 → 測試紅（驗證 guard 真的有效）→ 還原

---

### 風險

- **零 production code 改動**，只動 `vitest.config.ts` 與新增一支測試檔。
- 不影響 dev server、build、e2e、Playwright。

### 完成後狀態

- `bunx vitest run` 輸出乾淨，703 → 約 705+ 全綠（catalog smoke 增加 2–4 個 case）。
- Phase 3A.4 四項候選優化中，**1（Vitest config）+ 2（Catalog smoke）已完成**；3（portfolio scoping）等 roadmap 確認後再啟動；4（UI flag 進 store）依契約保留現狀。