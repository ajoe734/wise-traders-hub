## 問題

Benny 尚未發布任何訊號（`expert_signals` 0 筆、`trade_records` 0 筆），但 `/admin/benny/profile` 顯示「起始資金已設定，無法修改」— 鎖太早、無法調整。

根因：`src/pages/admin/Profile.tsx` L94-99 只要 `expert.starting_capital != null` 就 `setStartingCapitalLocked(true)`，跟 `CurrencyCard` 的「有發布訊號才鎖」規則不一致。

## 修正

**判定規則統一（跟資產類別一致）**：只有當該老師已存在至少一筆 `expert_signals`（status=published）時才鎖起始資金；沒有訊號時允許管理員/老師自由修改。

### 檔案變更

1. **`src/pages/admin/Profile.tsx`**
   - 讀 profile 時同步查該 expert 的已發布訊號數（重用現有 `expert.hasPublishedSignals` 若已存在；否則加一個輕量 count query）。
   - 改為 `setStartingCapitalLocked(hasPublishedSignals && expert.starting_capital != null)`。
   - 「確認設定」成功後也只在 `hasPublishedSignals` 為 true 才立即鎖住，否則保留可再改。

2. **`src/pages/_adminProfile/StartingCapitalCard.tsx`**
   - 當未鎖但已有先前設定值時，把按鈕文案由「確認設定」改為「更新起始資金」，並在說明加一行：「尚未發布訊號，仍可調整」。

3. **`src/hooks/admin/useAdminProfile.ts`**
   - `saveStartingCapital`：若已有值改為 update，仍走 `experts.starting_capital` 欄位；成功後 invalidate `useCapitalStatus` cache，讓可用現金重算。

### 不動的部分

- `admin_reset_expert_asset_class` RPC（切換幣別的完整重置）維持不變。
- `CurrencyCard` 鎖定規則不變（保持「已有發布訊號」判斷）。
- 已有訊號的老師仍鎖住起始資金（避免破壞 PnL 基準）。

### 驗證

- Benny (`/admin/benny/profile`)：起始資金欄可編輯，可存新值。
- 找一位已有 published 訊號的老師（如老周 master-zhou）：起始資金仍鎖住，顯示原本的三格摘要。
