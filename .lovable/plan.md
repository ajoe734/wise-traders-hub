## 已確認現況
- Benny 老師資料為 `currency=USD`、`asset_class=us_stock`，理論上只能使用「股」。
- 前台單筆 `SignalCreateDialog` 已用 asset spec 限制美股單位，但週記批次編輯器 `/admin/:expertSlug/signal-editor` 仍主要走 `currency` 舊 helper，且草稿/編輯回填可能保留舊 `張`。
- 批次週記發布流程 `publish-weekly-journals` 只把 pending 改 `published`，沒有在發布前依 expert asset class 正規化/驗證 `quantity_unit`。
- 目前 DB `handle_signal_trade()` 寫入 `trade_records` 時沒有帶入 `quantity_unit`，這會讓後續單位鎖定與持倉口徑繼續漂移。
- `enforce_unit_consistency()` 是用完整 `instrument` 比對，不是代碼 prefix；同一股票名稱不同或空白差異時，舊錯誤可能漏擋或誤判。

## 修正計畫
1. **批次週記表單改成 asset_class 單一來源**
   - 將 `TradeDraft.quantityUnit` 型別擴充為共用 `QuantityUnit`。
   - `SignalEditor` / `TradeCard` / `derive.ts` 從 `expert.asset_class` 解析 `getAssetSpec()`，不再只靠 `currency`。
   - 美股永遠只顯示/保存「股」，草稿若殘留「張」會在載入與送出前強制校正成「股」。

2. **送出前做硬性單位正規化與中文錯誤**
   - 在 `validateSignalBatch()` 補上 asset class 單位驗證：美股只能股、加密只能顆、衍生品只能口、台股張/股。
   - 在 `buildPublishRows()` 寫入前套用 `normalizeTradeUnitForAsset()`，避免 stale draft 或編輯舊批次把「張」帶進 pending。
   - 錯誤提示改成「Benny 是美股設定，只能填股；已自動改回股/請重新送出」這類明確中文。

3. **DB 端補齊資產單位守門**
   - 新增/更新 trigger function：依 `experts.asset_class` 檢查 `expert_signals.quantity_unit` 與 `trade_records.quantity_unit` 是否相容。
   - `us_stock` 禁止 `張`，`crypto` 禁止股/張，`us_option/us_future` 禁止非口；台股允許張/股。
   - 這是第二層防線，避免 Edge Function、RPC、舊 UI 繞過前端。

4. **修正 `handle_signal_trade()` 持倉寫入缺單位**
   - INSERT `trade_records` 時帶 `quantity_unit = NEW.quantity_unit`。
   - add/trim/partial close 路徑更新或新增 closed record 時保留既有/本次單位，避免持倉表出現 null 單位。
   - 同時維持 safe-skip log，不破壞現有防重複邏輯。

5. **修正 publish 排程的錯誤分類**
   - `publish-weekly-journals` 目前只認 `incompatible_unit_for_asset_class`、`unit_conflict`、`UNIT_MIX`；補認目前 DB 實際 hint `UNIT_LOCK` 與中文「單位不一致」。
   - 導師通知與 function log 會顯示明確修正入口與中文原因，不再只有 non-2xx/未知錯誤。

6. **資料檢查與必要回補**
   - 查 Benny 的 pending `expert_signals` 與 `trade_records`，把 `us_stock` 下殘留的 `張` 或 null 單位修正為 `股`（用 migration/RPC，不直接手動 update）。
   - 範圍不限 Benny：同時掃所有 `asset_class='us_stock'` expert，列出並修正同類錯誤，避免下一位老師重演。

7. **回歸測試**
   - 新增/更新單元測試：USD/us_stock 批次週記、草稿殘留張、buildPublishRows、validateSignalBatch。
   - 新增 DB 測試：us_stock 插入/發布 `張` 必擋、`股` 必通過、`trade_records` 會保存 `quantity_unit='股'`。
   - 擴充 live E2E：Benny us_stock 週記從填股數、儲存 pending、正式 publish 到持倉產生，全流程不再出現單位/資金換算錯誤。