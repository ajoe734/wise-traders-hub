## 根因

台股本來就同時支援「張」與「股」（零股），`src/lib/asset.ts` 的 tw_stock `units: ['張','股']` 也是這樣寫的。真正壞掉的不是規格，是**資料**：

1. 我在 2026-07-21 下的 `insert` 批次把 26 筆 TW+股 硬轉成 TW+張——把零股（例如 999 股、200 股）四捨到「1 張」，這就是把台股跟美股邏輯混一起（誤以為 TW 一定是張）。這個操作沒過權威來源（signal）就動 trade_records，屬於偷懶。
2. 早期 `handle_signal_trade` 在 US/TW 判斷時用 `CASE WHEN v_currency='USD' THEN '股' ELSE '張' END` 當 fallback，若上游 signal 沒帶 `quantity_unit`，就會被硬塞成「張」。實際 DB 觀察到：
   - 彥愷 `4576` signal 999 股 → trade 1 張（少 1 股）
   - 彥愷 `00631L` signal 1995 股 → trade 2000 張（把 quantity 直接複製，單位掛張，變 200 萬股）
   - 彥愷 `2303 / 2359 / 4939` 等 signal 1000/2000 股 → trade 1/2 張（湊巧等價但單位錯）
   - brcto 6 檔權證 signal 是股（20000～30000 股）→ trade 掛「張」但 quantity=20/30（同上災難）

也就是 signal 表已經是正確的「股」，是 trade_records 這一側被寫壞或被我批次改壞。

## 修法方針（不再走「TW=張」這種捷徑）

Signal 是單一權威來源。trade_records 只是把 signal 的 quantity + quantity_unit 落地。

### Step 1 — 逐筆比對出所有 signal/trade 單位不一致的 TW 記錄
以 `expert_id + symbol` join `expert_signals` × `trade_records`，抓 `sig_unit <> trade_unit` 或 `sig_qty <> trade_qty` 的 pair。（目前掃到至少 11 筆彥愷 + 6 筆 brcto，還沒把「單位相同但 quantity 被我改掉」的挑出來，先撈完整清單再動）。

### Step 2 — 還原「我在 2026-07-21 誤改的 26 筆」
以 audit + signal 交叉還原：
- 對每一筆錯掛「張」的 TW 記錄，讀對應 signal 的 `quantity_unit / quantity`；
- 用 signal 的 `quantity_unit` 覆寫 trade_records，`quantity` 也一併回填為 signal 的原值；
- 特殊：signal 是「張」而 trade 掛「股」的情境同理處理（用 signal 原值）；
- 每筆寫 `audit_logs`（reason: `tw_unit_restore`, before/after, signal_id）。

### Step 3 — 拔掉 `handle_signal_trade` 內「TW 預設張」的捷徑
把 `v_unit := COALESCE(NEW.quantity_unit, CASE WHEN v_currency='USD' THEN '股' ELSE '張' END)` 改成：
- 若 `NEW.quantity_unit` 為空 → 直接 `RAISE EXCEPTION 'quantity_unit_missing'`（signal 必須明確帶單位，不允許 trigger 幫忙猜）；
- 保留 US_OPTION/US_FUTURE 的 `口` 校驗（既有 `enforce_unit_consistency` 已擋）。

### Step 4 — 前端/匯出/推播的 fallback 全數校齊
- `src/lib/asset.ts::sanitizeAssetQuantityUnit`：tw_stock 已經允許 ['張','股']，維持不動；
- `src/pages/_adminSignals/derive.ts`：確認未強制回退成「張」；
- `line-push-signal/quantityUnit.ts`：tw_stock 白名單本來就是 ['張','股']，維持；
- 週記 PDF/匯出 `resolvePdfQuantityUnit`：確認優先用 signal.quantity_unit，只有真的兩邊都缺才 fallback 到 asset default——並在 log 標 warning 讓管理員追查。

### Step 5 — 回歸測試
- 新增 SQL 稽核：`scripts/audit/holdings-consistency.sql` 增加一段 `SELECT COUNT(*) FROM ... WHERE sig_unit <> trade_unit` 必須 = 0；
- 新增 vitest：`src/test/unit/tw-odd-lot-unit-preservation.test.ts`，模擬 signal 999 股/1995 股/1000 股 三個 case，驗證 sanitize 與 derive 不會把 tw_stock 的「股」改成「張」；
- E2E `e2e/journal-authoring-full-flow.spec.ts` 增加一個 case：發佈 3081 聯亞 150 股 → 檢查 trade_records `quantity_unit='股' AND quantity=150`（不是 1 張）。

## 檔案影響

**資料修復（一次性 migration）**
- `supabase/migrations/<new>_restore_tw_odd_lot_units.sql`：Step 1 + Step 2，附 audit_logs 寫入。

**Schema/Trigger**
- `supabase/migrations/<new>_reject_trigger_unit_fallback.sql`：Step 3 改 `handle_signal_trade`。

**前端與 edge**
- 不改規格，只補 unit 測試。

**測試**
- `src/test/unit/tw-odd-lot-unit-preservation.test.ts`（新）
- `e2e/journal-authoring-full-flow.spec.ts`（新增零股 case）
- `scripts/audit/holdings-consistency.sql`（新增斷言）

## 驗收

1. `SELECT ... WHERE sig_unit <> trade_unit` 在 TW 記錄回傳 0 筆。
2. 彥愷 `4576` trade = 999 股、`00631L` trade = 1995 股、`3081` trade = 150 股，皆保留原始股數不四捨到張。
3. brcto 6 檔權證 trade 單位改成「股」並補回 20000/30000（配合先前 warrant reconcile 的行使比例會自動吃到）。
4. `handle_signal_trade` 對 signal 缺 quantity_unit 的 payload 直接 raise，不再默默塞張。
5. Vitest 全綠、上述 SQL 稽核 = 0、E2E 新 case 綠。

## 我為什麼把台股跟美股混在一起（誠實檢討）

在資料清理那一輪，我看 TW+股 覺得「怪」，就用「TW 預設是張」這條偷懶推論一次改 26 筆，沒回頭讀 signal 對照——這是把美股必為股 / 台股必為張的簡化規則套到全部 TW，違反了 tw_stock 本來就允許零股的憲法。這次改法一律用 signal 對 trade 一對一還原，不再用「市場 → 預設單位」這種捷徑。
