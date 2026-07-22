# 週記撰寫零錯誤深掃 — 10 步細化計劃

目標：老師從「開草稿 → 填欄位 → 帶入持倉 → 送出 → 發布 → 匯出 → 推播」全程零錯誤、零單位錯亂、零資金誤鎖、零發布失敗、零 404。

---

## Step 1｜表單入口靜態盤點（read-only）
**檔案（窮舉，不抽樣）**
- `src/pages/_signalEditor/types.ts`（`emptyTrade`、`TradeDraft`、`OpenPosition`）
- `src/pages/SignalCreateDialog.tsx`、`SignalEditor.tsx`
- `src/pages/_signalEditor/CapitalPanel.tsx`、`StartingCapitalCard.tsx`、`CurrencyCard.tsx`、`TradeCard.tsx`
- `src/pages/_signalEditor/derive.ts`、`useAdminProfile.ts`
**檢查項**
- 每個欄位的預設值、可空、驗證、鎖定條件、錯誤 toast 文案
- `assetClass / currency / quantity_unit / direction / target_price / learning_points` 的預設是否跟 `expert.asset_class / currency` 一致
- 有無殘留 hardcode `'張'` / `TWD` / `tw_stock` fallback

## Step 2｜持倉帶入層盤點
**檔案**
- `src/hooks/useExpertHoldingsBundle.ts`
- `src/lib/positionQuantity.ts`、`asset.ts`、`sanitizeAssetQuantityUnit`
- `src/pages/_signalEditor/derive.ts`（`buildStepStates / computeCashSim / buildSimulatedPositions / validateSignalBatch`）
**檢查項**
- open/pending 4 資產 × 「帶入 buy/add/sell/exit」是否都用來源 `quantity_unit`，不再用資產預設值
- `resolveMaxBuyDraftQuantity` 對零股 / 非整千張 / 分點 crypto 是否安全
- `normalizeSignalQuantityToShares` 反向轉回是否無誤差
- oversell / capital-exceeded / unit-conflict 訊息是否帶得到來源 row_id

## Step 3｜DB 觸發器 & RPC 盤點
**對象**
- `public.handle_signal_trade()`
- `public.enforce_unit_consistency()` + `log_unit_lock_violation`
- `public.enforce_signal_capital_limit()`
- `public.get_expert_capital_status()`、`get_owned_journal_bundle`
- `admin_reset_expert_asset_class`、`profiles.expert_slug` sync trigger
**檢查項**
- 每一個 `RAISE EXCEPTION` 是否附中文 HINT + row_id + 允許值
- service_role 是否正確 bypass
- `get_expert_capital_status` 是否回傳 `quantity_unit / currency / asset_class`（前端已假設有）
- 台股「張」→ base shares × 1000 是否只在單一入口做一次

## Step 4｜資料稽核腳本（read-only，全量）
**新增 / 擴充**
- `scripts/audit-journal-authoring.mjs`：
  1. open/pending trade_records：`quantity_unit` × `asset_class` 一致性（美股不得為張、期貨必為口…）
  2. expert_signals 草稿與已發布：`target_price` 0/NULL、`quantity` 0、`direction` 缺、teaching 缺 `learning_points`
  3. `experts.starting_capital` vs 已發布資金佔用是否負數 / 溢位
  4. `profiles.expert_slug` 對應 `experts.slug` 缺漏
  5. `currency` × `asset_class` 不一致（us_stock + TWD 等）
  6. open 台股「張」但股數非 1000 倍數
**輸出**：每類明細 JSON + 筆數摘要（先讓你過目再修）

## Step 5｜發布路徑深掃（`publish-weekly-journals`）
**檔案**
- `supabase/functions/publish-weekly-journals/index.ts` + 相關 helper
- error code：`UNIT_CONFLICT / CAPITAL_EXCEEDED / OVERSELL / QUANTITY_ZERO / MISSING_FIELDS / TRIGGER_RAISED`
**檢查項**
- 每個 error code 都有中文訊息 + 修正連結 + notification insert
- per-signal 失敗不會拖垮整批
- 通知 link 一律為相對路徑（承接先前規則）
- Deno test 覆蓋每個 error code ≥ 1

## Step 6｜匯出 / 推播單位單一來源盤點
**檔案**
- `src/lib/exportJournalPdf*`、`src/test/exportJournalPdfQuantityUnit.test.ts`
- Markdown 匯出（JSZip 路徑）
- `supabase/functions/line-push-signal/index.ts` + `quantityUnit.ts`
**檢查項**
- 4 資產 × TWD/USD 皆走 `resolvePdfQuantityUnit / resolveLinePushQuantityUnit`
- 任何 `'張'` 字面 fallback 全刪
- Markdown zip 中 mentor-per-file 檔名 slug 對非 ASCII 安全

## Step 7｜顯示層盤點
**檔案**
- `src/pages/JournalDetail.tsx`、`SignalDetail.tsx`、`TradeItem`
- `HoldingsPanel / HoldingsDetailPanel / CapitalPanel` 表格欄位
**檢查項**
- teaching 訊號 `learning_points` 一定渲染
- currency fallback（無 signal.currency → expert.currency → USD/TWD 推導）
- 查詢欄位不再遺漏 `asset_class / quantity_unit / currency`
- 「目前持倉」欄名為「數量」而非「股數」，label 一律走 `formatBaseQuantity`

## Step 8｜根因修法（依 Step 1–7 產出的清單一次修完）
- 表單：即時提示（單位鎖、幣別、方向、目標價 0、賣超、資金）
- 資金鎖：`StartingCapitalCard` 對 pending 訊號的判斷、跨幣別換算
- 發布：per-signal error 中文化補齊、修正連結覆蓋所有 code
- 匯出 / 推播：三通道單位、幣別、方向一致
- 觸發器：所有 raise 皆帶 row_id + 允許值 + 中文 HINT
- 顯示：teaching / currency / asset_class 殘留查詢

## Step 9｜回歸驗證（窮舉）
**Vitest（既有 1745 + 新增）**
- `positionQuantity` × 4 資產 × 邊界（0、非整千、負值、極大值）
- `sanitizeAssetQuantityUnit` × 每個錯誤單位輸入
- `resolvePdfQuantityUnit / resolveLinePushQuantityUnit` 對照矩陣
**Playwright E2E**
- `journal-authoring-full-flow.spec.ts`：確認 4×4 矩陣仍全綠
- `journal-authoring-boundary.spec.ts`：目標價 0 / 股數 0 / 賣超 / 資金爆表 / UNIT_CONFLICT
- 新增：「發布失敗 → 通知連結可點 → 落到修正頁」
- 新增：「4 資產 × publish → PDF → LINE payload」單位一致
**Edge function Deno tests**
- `publish-weekly-journals` 每個 error code ≥ 1 case
**資料稽核腳本**重跑：全類別歸零

## Step 10｜收斂與交付
- 產出 `docs/qa/journal-authoring-audit.md`：Step 1–4 清單 + Step 8 修法對照表 + Step 9 測試清單
- CI 加掛：`audit-journal-authoring.mjs` 作為 nightly job（發現新錯即告警）
- 更新 `mem://features/mentor-publishing-workflow` 與 core memory：「單位單一來源 + 發布 error code 中文化」正式列為憲法
- 回報你：稽核歸零 + 全綠測試截圖 + 修法檔案清單

---

## 執行節奏
Step 1–4 純讀，先完成一次「完整缺陷清單」交你過目再進入 Step 5–10 動刀，避免又是「改一半還有剩」。同意後我在 build 模式一次跑完。
