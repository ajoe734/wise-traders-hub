# 讓 mentor 週記不再強制綁交易

## 現況確認（為什麼現在發不出來）

週記在資料模型上就是 `expert_signals` 一筆紀錄。`SignalCreateDialog.handlePublish` 目前的硬性檢查（src/pages/_adminSignals/SignalCreateDialog.tsx L135–164）：

1. 股票代碼必填
2. action 必填（buy / add / trim / sell / exit）
3. quantity > 0 必填
4. price_hint > 0 必填
5. `add/trim/sell/exit` 還會查 `trade_records` 是否有未平倉部位

因此本週沒有任何進出場時，mentor 完全送不出週記。

## 這次要做的兩件事

### A. 新增「純教學週記」模式（mentor 限定）

在 `SignalCreateDialog` 上方加一個切換：「本週類型 = 交易週記 / 純教學週記」。當選「純教學週記」時：

- 隱藏股票代碼 / 操作方向 / 數量 / 價格 / 風險備註欄位
- 只保留：教學主題（必填）、整體摘要、學習重點
- `canPublish` 改為只看教學主題有填
- `handlePublish` 寫入 `expert_signals`：
  - `instrument = ''`、`action = 'teaching'`（新值，見下）
  - `price_hint / quantity / quantity_unit = null`
  - 不觸發任何 `trade_signals` / `user_performances` 副作用
  - 不觸發 `line-push-signal`（advisor 不會走到這支）
  - `status = 'pending'`（照舊週五 20:00 統一發）

### B. 對既有持倉新增「觀察 / hold」非交易動作

在 mentor 的「交易週記」模式新增 action `hold`，代表「本週只對既有持倉做評論，不進出場」。

- 必填：股票代碼、教學主題（mentor）；數量 / 價格改為選填
- 必須先有對應 `trade_records.status='open'` 部位，否則擋下（與 trim/sell 同樣防呆）
- `handlePublish` 不動 `trade_signals` 也不動 `user_performances`
- 走一般 mentor `pending` 流程，週五一起發

## DB 與型別

新增一個 migration，把 `expert_signals.action` 的 enum 補上 `'hold'` 與 `'teaching'`。`expert_signals` 既有欄位（instrument, price_hint, quantity）允許 null 或空字串即可，不用結構改動，但若 `instrument` 目前是 NOT NULL，純教學模式要允許空字串（不改 nullable，前端送 `''` 即可）。

對應更新 `src/integrations/supabase/types.ts` 內的 enum 型別。

## Edge function：publish-weekly-journals

`supabase/functions/publish-weekly-journals/index.ts` 的 `sync_trade_signals` 迴圈目前 switch 在 `action === 'exit' / sell / trim / 其他（視為 buy）`。需要加入兩個分支：

- `action === 'teaching'`：完全跳過 trade_signals / user_performances 同步，也跳過 stockCode 解析
- `action === 'hold'`：跳過 trade_signals / user_performances 寫入（既有持倉不動）

LINE 推播文案（既有 `htmlToText` 與 flex message 組裝）要能處理沒有股票代碼的純教學週記：標題改成「📚 本週教學週記」，內容用 teaching_topic + overall_summary + learning_points。

## SignalRow / SignalEditor

- `src/pages/_adminSignals/SignalRow.tsx`、`src/pages/admin/Signals.tsx` 的列表顯示需要對 `hold` / `teaching` 顯示對應 badge（例如「觀察」「教學」）
- `src/pages/admin/SignalEditor.tsx` 編輯舊週記時，能正確還原這兩種模式並沿用對應驗證

## 不會動到的事

- 不改 advisor 即時訊號流程
- 不改既有 buy/add/trim/sell/exit 的驗證與 trade_records 寫入
- 不改 demo / 首頁 / 文案以外的東西
- 不改 RLS / 安全 audit

## 測試

- 補 unit：`canPublish` 在純教學模式只看 teaching_topic
- 補 integration：`hold` action 寫入後 trade_signals / user_performances 不變
- 跑既有 1.18-weekly-publish-rls + publish-weekly-journals 相關測試確保不回歸

## 完工後回報

- migration 內容
- 改了哪些檔案
- handlePublish 兩個模式的驗證規則
- edge function 對 teaching / hold 的處理
- 測試結果
