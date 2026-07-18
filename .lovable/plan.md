## 根因

7/14 那筆 `teaching` 訊號在 DB 中：`instrument / price_hint / quantity / reason_summary / reason_detail / risk_notes` 全為 null，內容全部存在 `learning_points`（含 `<img>` 圖片）。前端 `src/pages/app/JournalDetail.tsx` 的 `TradeItem` 有三個缺口讓它渲染成空白列：

1. **`hasDetails` 沒把 `learning_points` 算進去**（L56），因此沒有展開按鈕。
2. **展開區塊完全沒渲染 `learning_points`**（L121–147 只處理 reason_summary / reason_detail / risk_notes）。
3. **`ActionBadge`（`src/components/ActionBadge.tsx`）沒有 `teaching` 與 `hold` 的 config**，落到 `config?.label ?? action` → 顯示無底色的英文字串 "teaching"，跟其他有色徽章視覺不一致。

底部「本週教學重點」的確有把所有 `learning_points` 用 `richHtmlToPlain` 抽成文字條列，但那是聚合區塊，**不是這筆 teaching 的原文**；而且純文字化會丟掉圖片，導致老師嵌入的圖表看不到。

## 修改範圍

### 1. `src/components/ActionBadge.tsx`
新增 `teaching` 與 `hold` 兩個 config：
- `teaching`：`label: '教學'`，套用 mentor 語意色（`bg-mentor text-white border-mentor`），對齊 `src/pages/_adminSignals/actionLabels.ts` 既有 mapping。
- `hold`：`label: '觀察'`，中性色（`bg-muted text-foreground border-border`）。
- 型別擴充讓 `SignalAction` 或這裡的 `actionConfig` 涵蓋兩個新值（沿用現有 `as any` 呼叫端不會壞）。

### 2. `src/pages/app/JournalDetail.tsx` `TradeItem` 元件
- **L56**：`hasDetails` 加入 `signal.learning_points`。
- **L96**：`teaching` 動作視為無交易的教學筆記 → 隱藏「價/股/總額（FxHint）」整段（即使 DB 髒資料塞了數字也不顯示）；`displayInstrument` 為空時，改顯示日期左側的「教學筆記」文字，避免只剩孤零零的日期。
- **展開區塊**：在 `risk_notes` 之後補一段 `learning_points` 渲染，圖示用 `BookOpen`（已 import 過），標題「教學重點」，用 `SafeRichHtml` 保留 `<img>` 等富文本。
- **預設展開策略**：teaching 條目 `useState(true)`（有 details 時預設展開），避免使用者以為沒內容；其他動作維持折疊。

### 3. 不動的部分
- 底部「本週教學重點」聚合區塊維持現狀（純文字條列 + 匯出 PDF 依賴）。
- DB schema、edge function、資料來源全部不動——這是純前端顯示 bug。
- SignalDetail（單筆訊號頁）不在此次修改範圍，若同樣缺陷再獨立處理。

## 驗證

- 型別檢查（tsgo）。
- 打開受影響的週記，確認：
  - `teaching` 徽章有 mentor 藍底、文字為「教學」。
  - 07/14 那筆展開後顯示 learning_points 原文與嵌入圖片。
  - 沒有殘留的「價 / 股」欄位。
- 既有 e2e：`journal-detail-owner-preview*.spec.ts`、`journal-detail-title-collapse.spec.ts` 不應被影響（斷言主要在標題與 owner fallback）。
- 補一支輕量 e2e/單元：`teaching` 條目渲染 `learning_points` 且不顯示價量欄位（可延後，主要修復先落地）。
