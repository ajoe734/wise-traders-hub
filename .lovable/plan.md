# 修正台股 ETF 英數字尾（00631L、00878B、00679B 等）被過濾的問題

## 根因

台股 ETF 有槓桿 (L)、反向 (R)、債券 (B) 等變體，代碼格式為「4–6 位數字 + 選填 1 個大寫英文字母」，例如 `00631L`（元大台灣 50 正 2）、`00878B`（國泰投資級公司債）、`00679B`（元大美債 20 年）。

但前端 `TW_SYMBOL_RE = /^\d{4,6}$/` 只允許純數字，也沒對 TW 輸入做 uppercase。老師在週記 / 訊號編輯器輸入這類代碼時：
1. 打大寫 → 名稱可查到，但按「發布」時被 `isValidSymbol` 擋 → toast「代碼格式錯誤」。
2. 打小寫 → 沒 uppercase → regex 更不可能過。

同一 pattern 也散在多個 edge function，導致後端價格同步、法說會公告等資料流也漏這些 ETF（用戶未直接看到，但已造成資料破損）。

## 修改範圍（窮舉）

### 前端（用戶主訴路徑）

| 檔案 | 位置 | 修改 |
|---|---|---|
| `src/lib/currency.ts` | L45 `TW_SYMBOL_RE` | `/^\d{4,6}$/` → `/^\d{4,6}[A-Z]?$/` |
| `src/lib/currency.ts` | L47–51 `isValidSymbol` | TW 分支加 `.toUpperCase()`，與 USD 對稱 |
| `src/lib/currency.ts` | L54 `symbolPlaceholder` | 台股 placeholder 補範例：`例：2330 / 00631L` |
| `src/lib/asset.ts` | L47 `tw_stock.symbolRegex` | `/^\d{4,6}$/` → `/^\d{4,6}[A-Z]?$/` |
| `src/lib/asset.ts` | L48 `symbolPlaceholder` | 同上補範例 |
| `src/lib/asset.ts` | L50 `tw_stock.uppercaseSymbol` | `false` → `true`（純數字 uppercase 為 no-op，改動零風險） |
| `src/pages/_signalEditor/TradeCard.tsx` | L78 | `const v = isUsd ? raw.toUpperCase() : raw;` → 一律 `raw.toUpperCase()`（TW 純數字不受影響） |
| `src/pages/admin/SignalEditor.tsx` | `fetchStockInfo` (L140–157) | 送出前 `c = c.toUpperCase()`，避免大小寫快取分裂 |

`src/pages/_adminSignals/SignalCreateDialog.tsx` 已透過 `spec.uppercaseSymbol` + `isValidAssetSymbol` 走 asset spec → 只要上面兩個 lib 改完就自動生效，不需再改。

`src/pages/_signalEditor/derive.ts:195` 已 `.trim().toUpperCase()` → 只等 regex 放寬。

### 後端 Edge Functions（資料一致性）

| 檔案 | 位置 | 修改 |
|---|---|---|
| `supabase/functions/stock-price-sync/index.ts` | L226, L325 | `/^\d{4,6}$/` → `/^\d{4,6}[A-Z]?$/i` |
| `supabase/functions/checkup-warrant-sync/index.ts` | L57 | 同上 |
| `supabase/functions/checkup-mops-announcements/index.ts` | L83 | 同上 |
| `supabase/functions/backfill-daily-snapshots/index.ts` | L88 | 同上 |

已支援 `[A-Z]?` 不需改：`checkup-analyst-reports`、`checkup-mops-revenue`、`_shared/validation_schemas_test.ts`。

`stock-name-lookup` 對代碼無 pattern 限制、TWSE MIS `tse_00631L.tw` 本來就可解析 → 不需改。

### 測試補齊

| 檔案 | 新增 case |
|---|---|
| `src/test/unit/currency.test.ts` | `isValidSymbol('00631L','TWD')=true`、`'00878B'=true`、`'00679B'=true`、`'0050'=true`、`'00631l'=true`（小寫接受）、`'00631LR'=false`（雙字母）、`'123'=false` 保留、`'12345B'=true`（5 碼 + B） |
| `src/test/unit/assetSpec.test.ts` | 同上以 `isValidAssetSymbol(..., 'tw_stock')` 覆蓋；追加 `getAssetSpec('tw_stock').uppercaseSymbol === true` |

## 驗證步驟

1. `bunx vitest run src/test/unit/currency.test.ts src/test/unit/assetSpec.test.ts`
2. `bunx tsgo --noEmit` 確認型別
3. 手動：以老師身份在 SignalEditor 輸入 `00631l` → 自動變 `00631L`、名稱帶回「元大台灣 50 正 2」、按發布不擋。
4. 部署 4 個 edge functions 後檢查 `stock-price-sync` 下一輪跑批 log 有納入英數尾 ETF symbol。

## 不做

- 不擴充到多字母尾（`00631LR` 這種目前市場上不存在）。
- 不動 auto-gen (`src/integrations/supabase/client.ts`、`types.ts`)。
- 不修改 auth/storage 相關 schema。
