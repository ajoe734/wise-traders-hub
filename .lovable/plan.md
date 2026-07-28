## 目標

讓 `ray.tsai@cctech-support.com`（expert `阿基米德投資學` / slug `master-lever`）能用「組」為單位，直接記錄圖中那種多腿選擇權組合單（垂直價差、鐵兀鷹等），系統原生理解 legs、權利金淨額與最大損失。

## 已核實現況

- `master-lever` 目前 `asset_class = tw_stock`、`currency = TWD`、`starting_capital = 10000`、`id = 1dfe0420-…`。
- `src/lib/asset.ts` 的 `us_option` 只允許單位 `['口']`，symbol 必須符合 OCC 21 碼（`US_OPTION_RE`），乘數固定 1（檔頭註明「方案 A：只做部位紀錄」）。
- DB 觸發器 `enforce_unit_consistency` 用 `v_allowed` 白名單依 asset_class 擋單位，`組` 會被擋。
- `expert_signals` / `trade_records` 目前皆無 legs、max_loss、net_premium 等欄位，組合單無處可存。

## 資料模型（原生組合單）

### 1. `expert_signals` 增欄

- `is_combo boolean default false`
- `combo_strategy text`（`vertical_call` / `vertical_put` / `iron_condor` / `custom`…）
- `net_premium numeric`（每組淨權利金，正=收權利金 credit，負=付出 debit）
- `max_loss_per_unit numeric`（每組最大損失，USD）
- `max_profit_per_unit numeric` nullable
- `quantity` = 組數，`quantity_unit = '組'`

### 2. 新表 `public.expert_signal_legs`

欄位：`signal_id`（FK，on delete cascade）、`leg_index`、`occ_symbol`、`underlying`、`expiry date`、`right`（C/P）、`strike numeric`、`side`（long/short）、`ratio int default 1`、`leg_price numeric`。

含完整 GRANT（authenticated / service_role；public 讀取沿用訂閱可見規則）、RLS：擁有者與已訂閱者可讀，擁有者可寫。

### 3. `trade_records` 對應

同樣加 `is_combo` / `combo_strategy` / `max_loss_per_unit` / `net_premium`，legs 用 `trade_record_legs` 或共用 `expert_signal_legs`（以 signal_id 關聯）；持倉以「組」為部位單位，避免拆腿後 oversell 誤判。

## 風控與計算

- `us_option` 乘數改為 100（單腿仍 `price × qty × 100`）。
- 組合單資金佔用 = `組數 × max_loss_per_unit`（credit spread 用寬度差×100−權利金；debit spread 用付出的權利金）。
- `enforce_unit_consistency`：`us_option` 白名單改 `['口','組']`。
- `enforce_signal_capital_limit`：若 `is_combo`，改用 `quantity × max_loss_per_unit`；否則 `price_hint × quantity × 100`。
- oversell / 平倉檢查：組合單以 `combo key`（strategy + legs 指紋）比對庫存，不與單腿混算。

## 前端

1. **SignalEditor 新增「組合單」模式**（只在 `us_option` 出現）
   - 策略選擇：Bull Put / Bear Call / Bull Call / Bear Put / Iron Condor / 自訂
   - 逐腿輸入：標的、到期日、C/P、履約價、買/賣、口數比
   - 自動組出每腿 OCC 21 碼、自動算 `net_premium`、`max_loss_per_unit`、`max_profit_per_unit`（自訂策略可手動覆寫）
   - 數量欄位標為「組」，即時顯示「本單最大損失 = 組數 × 每組最大損失」
2. **展示層**：週記詳情、訊號列表、持倉看板顯示 `SNDK 950/925P + 1600/1625C ×1 組`，展開可看四腿明細與最大損失。
3. **Markdown 匯出**：組合單輸出策略名稱、legs 表格、每組最大損失、總最大損失，不再拆成四筆看似獨立的交易。
4. `src/lib/asset.ts`：`us_option.units = ['口','組']`、`multiplier = 100`、新增 `buildOccSymbol()` 與 combo 型別。

## 帳號切換

- 用既有 `admin_reset_expert_asset_class` 將 `master-lever` 由 `tw_stock` 改為 `us_option`，`currency → USD`。
- `starting_capital` 保留 10000，改視為 10000 USD（不清空、不改數字），留 audit log。

## TDD

先寫測試再實作：

- `src/lib/asset` 單元測試：`us_option` 允許 `組`、乘數 100、OCC builder（履約價 padding、小數、C/P、日期）。
- combo 計算單元測試：Bull Put credit spread、Bear Call、Iron Condor 的 `net_premium` / `max_loss` / `max_profit` 標準案例，含圖中 `SNDK 950/925P + 1600/1625C`（總最大損失 $1,725 為驗收基準）。
- DB 觸發器測試：`組` 通過、`張` 被擋、combo 資金上限用 max_loss 計算。
- `e2e/journal-authoring-full-flow.spec.ts` 矩陣加入 `us_option` 單腿與組合單兩列。
- 新增 `e2e/journal-combo-spread.spec.ts`：以 `master-lever` 建立圖中兩個方案 → pending → 預覽 → Markdown 匯出，不觸發風險攔截。

## 不做

- 不接選擇權自動行情（維持 manual override 報價）。
- 不做希臘值 / IV 計算。
- 台股與加密不引入「組」。