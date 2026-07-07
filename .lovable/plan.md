## 問題全貌

錯誤訊息：`null value in column "quantity_unit" of relation "expert_signals" violates not-null constraint`

### 根因（不是單點 bug，是「DB schema 與應用層設計意圖不一致」）

DB 目前狀態：
```
quantity_unit  NOT NULL  DEFAULT '張'
```

但整個系統的其它層都是**以「quantity_unit 可為 null」為前提**在寫的：

1. **前端 `src/pages/_signalEditor/derive.ts`**
   - L311 `buildPublishRows`：當 `action='hold'` 且沒填 quantity 時，明確送 `quantity_unit: null`
   - L345 `buildTeachingOnlyRow`：純教學週記（mentor 儲存週記、完全沒交易）永遠送 `quantity_unit: null`
   - 明確送 `null` 會**繞過 column default `'張'`**，直接撞 NOT NULL

2. **DB triggers（`handle_signal_trade` 等）**
   - 多處寫法是 `COALESCE(NEW.quantity_unit, '張')`，代表 trigger 作者本來就預期這欄可能是 null
   - 亦即 trigger 層的合約是「nullable + fallback '張'」，但 column constraint 卻是 NOT NULL — 兩者矛盾

3. **讀取端 `_adminSignals/derive.ts` L114**
   - `const unit = s.quantity_unit || '張'` — 讀取端也在 defensively fallback，同樣預設可能為 null

4. **既有資料**：71 筆 expert_signals 全部 `quantity_unit` 有值，沒有髒資料，不需要 backfill

### 觸發場景（不只你截圖那一個）

- ✅ **Mentor 純教學週記**（你剛剛遇到的）— 100% 觸發
- ✅ **Hold 觀察列不填 quantity** — 100% 觸發
- 一般買賣訊號因為前端強制帶 `quantityUnit`（預設 '張' 或 '股'），所以沒事

## 修正方案（兩層同時修，才不會頭痛醫頭）

### 1. DB 遷移：把 column 改成可 null（與 trigger 的 COALESCE 合約對齊）
```sql
ALTER TABLE public.expert_signals
  ALTER COLUMN quantity_unit DROP NOT NULL;
-- default '張' 保留，讓未明確傳值時仍有 fallback
```
理由：trigger 與讀取端本來就以 nullable 為前提；把 constraint 對齊設計意圖，比「強迫每個 insert 塞值」乾淨。

### 2. 前端 payload 清理：`src/pages/_signalEditor/derive.ts`
- `buildTeachingOnlyRow`：純教學列語意上就沒有交易，維持送 `null`（DB 放寬後合法）
- `buildPublishRows` L311：同上，hold 無 quantity 時送 `null` 合法
- 不再需要為了繞過 constraint 而強塞 `'張'` 假值汙染資料

### 3. 驗證
- `psql` 確認 column 已可為 null
- 手動：mentor 面板 → 儲存純教學週記 → 應成功
- 手動：hold 列不填 quantity → 儲存成功
- 一般買賣訊號回歸：`quantity_unit` 仍寫入正確值
- 跑 `src/test/integration/1.16-signal-trade-trigger.test.ts` 與 `1.36-teaching-hold-journal.test.ts` 確認 trigger 行為沒退化

## 為何不用「只改前端塞 '張'」的偷懶版

那樣做的話：
- 純教學週記的資料裡會有一個假的 `'張'`，語意不對（根本沒交易）
- Trigger 的 `COALESCE` 分支永遠不會被觸發，未來一旦有直接寫 DB 的路徑（edge function / SQL）又會踩雷
- Schema 與 trigger 合約仍然不一致，債務累積

## 影響範圍檢查（已窮舉，無其他撞點）

搜過所有 `quantity_unit` 出現的檔案：
- `src/pages/_signalEditor/derive.ts` — 上面已處理
- `src/pages/_adminSignals/SignalCreateDialog.tsx` L174 / L375 — 一定帶 state `quantityUnit`，不會 null，不受影響
- `supabase/functions/publish-weekly-journals/index.ts` — 只 SELECT，不 INSERT
- `useSignalEditorData.ts` / `SignalRow.tsx` / `JournalDetail.tsx` / `SignalDetail.tsx` / `UnrealizedTab.tsx` / `linePushLogic.ts` / `useExpertHoldingsBundle.ts` — 全是讀取端
- 三支 migration（0505 / 0514）都是 trigger 內用 `COALESCE(...,'張')`，與新 nullable 設計相容
