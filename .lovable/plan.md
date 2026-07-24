## 執行順序：先方案 B 止血，再方案 C 契約歸位

---

## Phase B — 顯示層契約統一（1 個 PR，可立刻上線）

### B1. `src/hooks/useExpertHoldingsBundle.ts` — `mapOpenPositionToRow`
- `shares = normalizeQuantityToBaseUnits(p.quantity_shares, p.quantity_unit)`（若上游已是 base 就吃 base；`張` 才 ×1000）。實際上 `open_positions` 來自 `get_expert_capital_status` RPC，`quantity_shares` 已是 base 股數，這裡改為：
  - `const display = resolvePositionQuantityDisplay(baseShares, p.quantity_unit, rowAsset)`
  - `quantity: display.inputQuantity`（給 UI 顯示用）
  - `quantity_unit: display.unit`
  - 另外新增 `base_quantity: baseShares` 欄位，保留給後端計算（pnl / 成本 / 匯出）用。
- pnl / pnl_percent 用 `baseShares` 算，不受顯示單位影響。

### B2. `src/pages/_adminPerformance/types.ts`（`PerfRow`）
- 新增 `base_quantity?: number | null`；`quantity` 註記為「顯示單位下的數量」。

### B3. 顯示層防呆（`UnrealizedTab.tsx` / `SignalsTable.tsx` / `CapitalPanel.tsx` 等所有 render `PerfRow` 的地方）
- 統一改走 `formatBaseQuantity(row.base_quantity ?? row.quantity, row.quantity_unit, row.asset_class)`，禁止手動拼 `${quantity} ${unit}`。
- 找 call sites：`rg -n "quantity_unit" src/pages src/components`，逐一遷移。

### B4. Signals 頁 admin footer `computeHoldingSummary`（`src/pages/_adminSignals/derive.ts`）
- 目前手算 `qty * 1000`；改為呼叫 `normalizeQuantityToBaseUnits`，並用 `resolvePositionQuantityDisplay` 產出摘要文字。

### B5. 測試鎖契約（`src/test/unit/`）
- `mapOpenPositionToRow.test.ts`（新增）：
  - `quantity_shares=1000, quantity_unit='張', tw_stock` → `quantity=1, unit='張'`
  - `quantity_shares=500, quantity_unit='張', tw_stock` → `quantity=500, unit='股'`（零股回退）
  - `quantity_shares=10, quantity_unit='股', us_stock` → `quantity=10, unit='股'`
  - `quantity_shares=2, quantity_unit='口', us_future` → `quantity=2, unit='口'`
- render test：`UnrealizedTab` 用 mock row `{quantity_shares:1000, quantity_unit:'張'}` 螢幕上是 `1 張`。

### B6. 驗證
- `tsgo`、`bunx vitest run` positionQuantity / mapOpenPositionToRow / UnrealizedTab render。
- Playwright 對 `/admin/{slug}/performance` 4576、2356 截圖，肉眼確認顯示為 `1 張` 而非 `1000 張`。

---

## Phase C — 資料層契約歸位（獨立 PR，Phase B 上線後啟動）

### C1. 資料稽核（read-only）
- 用 `supabase--read_query` 跑：
  ```sql
  SELECT expert_id, symbol, quantity, quantity_unit, asset_class
  FROM trade_records
  WHERE status='open' AND asset_class='tw_stock'
    AND quantity_unit='張' AND quantity % 1000 <> 0;
  ```
- 產出「異常清單」與影響專家清單，附在 migration description。

### C2. Migration：契約明文化
- `trade_records` 新增 `CHECK`：
  - `asset_class='tw_stock' AND quantity_unit='張' → quantity % 1000 = 0`
  - `asset_class='us_stock' → quantity_unit IN ('股')`
  - `asset_class IN ('us_future','us_option','tw_future','tw_option') → quantity_unit='口'`
  - `asset_class='crypto' → quantity_unit='顆'`
- 先跑「資料修復」再加 CHECK：把 C1 抓到的 `張 + 非 1000 倍數` 一律改成 `股`（不動 quantity 值）。
- 註解：`quantity` 一律是 base 單位；`quantity_unit` 是偏好顯示單位。

### C3. `handle_signal_trade()` 契約強化
- 每次 upsert 前：
  - `v_base = normalize_to_base(input.quantity, input.quantity_unit, expert_class)`（SQL helper）
  - `NEW.quantity = existing.quantity ± v_base`
  - `NEW.quantity_unit = sanitize_asset_unit(preferred_unit, expert_class)`（比照 `src/lib/asset.ts::sanitizeAssetQuantityUnit`）
- 移除目前 `COALESCE(existing.quantity_unit, v_unit)` 這條卡住第一次單位就永不改的邏輯 —— 改成用資產類別的預設單位重算。

### C4. RPC `get_expert_capital_status` 輸出契約
- 每筆 open position 補一個 `display_quantity` / `display_unit` 欄位（server 端 sanitize），前端 fallback 少一段。

### C5. 測試 & 稽核
- pgTAP：CHECK 拒收 `張+999`；`handle_signal_trade` 混單位（先 1 張、後加 999 股）→ 落成 `1999 股, unit='股'`。
- Node script：新增 `scripts/audit-holding-unit-contract.mjs`，CI 跑，任何違反 CHECK 的 row 直接紅燈。
- Playwright 回歸：4576 / 2356 / benny us_stock / benny us_future 四情境快照。

### C6. 上線
- Migration → 部署 → 觸發 `converge` 全量重算 → 稽核腳本綠燈 → 移除 Phase B 中 `mapOpenPositionToRow` 的 fallback（因為契約已強制），保留 formatter。

---

## 交付順序
1. Phase B（B1–B6）一次 PR，優先合入止血。
2. B 上線並肉眼確認 4576/2356 顯示正確後，開 Phase C。
3. C 分兩個 migration：資料修復（可 rollback）→ 加 CHECK（不可 rollback，需 B 已穩定）。

批准後我按 B → C 順序執行，中間會回報 B 完成再啟動 C。
