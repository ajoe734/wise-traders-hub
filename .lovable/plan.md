# 移除持倉卡的「標記為持有」按鈕（方案 A）

## 問題根本

`src/pages/FreeCheckup.jsx` line 3774-3812 的 OVERRIDE 區塊把 DECISION 引擎的內部「覆寫」機制包成「標記為持有」按鈕。但這張卡本身就是**持倉細節卡**——能看到它代表已持有，再叫使用者「標記為持有」邏輯打架；「覆寫」更是內部術語，使用者不需要看到。

## 變更

**檔案**：`src/pages/FreeCheckup.jsx`，line 3774-3812（OVERRIDE 區塊）

**移除**
- 「標記為持有」按鈕（含 `setUserOverrides` 整段 onClick handler）
- 「無需覆寫 / 已覆寫為持有」文案
- 36×36 ✎ 小方塊鈕

**改成**
卡片底部一個全寬「編輯持倉」次要按鈕，呼叫既有 `openHoldingDrawer(h.code)`：
- 樣式：`background: transparent`、`border: 1px solid ${WB.hair}`、`color: WB.inkSub`、`fontSize: 12`、`padding: 12px`、`letter-spacing: 0.08em`、`borderRadius: 2`、`fontFamily: 'inherit'`
- 文字：`編輯持倉`
- 包在原本 `paddingTop:14, marginTop:6, borderTop:1px solid ${WB.hair}` 的容器內，去掉 flex gap 改單一全寬按鈕

## 不動的部分

- `userOverrides` state 與相關邏輯保留（其他地方可能還會用到，例如 dossier drawer 內部）
- DECISION 黑底盒、URGENCY、TARGET、EVENT TIMELINE、PnL 區塊全部不動
- `openHoldingDrawer` 行為不動

## QA（依 Core 規則強制）

改動只在卡片底部按鈕列，不觸及 PnL 大字（fontSize 48）也不改 Hero，但仍屬 `.wb-card` 持倉看板範圍：
- 跑 [FreeCheckup 手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist)：560 / 390 / 380px 三斷點靜態檢查 + 視覺截圖
- 跑 `bunx playwright test e2e/freecheckup-card.spec.ts`
- 跑 [FreeCheckup i18n 回歸](mem://qa/checkup/freecheckup-i18n-regression)
