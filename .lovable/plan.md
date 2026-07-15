# 持倉看板 vs. 交接規格（`DESIGN_HANDOFF.md` 2026-07-15）偏差修正

## 診斷結論

規格 §3.4「持倉卡（1c）」定義了四層：**標頭 → 報酬條 → 價格軌 → 頁腳**，且明確列出**刪除清單**。專案裡雖然已抽出符合規格的 `_ui/ReturnBar.tsx`（±40% 尺規＋▸ 破表）與 `_ui/PriceTrack.tsx`（1px 髮絲線＋圓點），但 `HoldingCard.tsx` 從沒 import 它們，實際渲染仍是舊 4 層。以下逐項比對。

### A. 標頭（`_ui/holdingCard/HoldingCardHeader.tsx`）
| 規格 §3.4 步驟 1 | 現況 | 判定 |
|---|---|---|
| `名稱 代號` + 「檢視／出場」中文徽章 | 顯示 `EXIT`/`REVIEW`/`HOLD` 英文小標 | ❌ |
| HOLD **不標** | HOLD 仍渲染 | ❌ |
| 只留產業 tag（權證虛線框） | 仍有 `策略 tag`、`教學徽章`、`回報` 虛線鈕 | ❌ |
| 股數移入抽屜 | 卡頭仍列 `× N 股` | ❌ |
| Sparkline 屬抽屜 §4.2 | 卡頭仍畫 60×20 sparkline | ❌ |

### B. 報酬條（`_ui/holdingCard/HoldingCardReturn.tsx`）
| 規格 §3.4 步驟 2 | 現況 | 判定 |
|---|---|---|
| 8px 橫條軌＋±40% 尺規＋`▸` 破表 | 只有大字 ROI 百分比，無條軌 | ❌（`_ui/ReturnBar.tsx` 未接） |
| 數字照實顯示、正 accent／負 --loss | ✅ | ✅ |

### C. 價格軌（`_ui/holdingCard/HoldingCardPriceTrack.tsx`）
| 規格 §3.4 步驟 3 | 現況 | 判定 |
|---|---|---|
| 1px 髮絲線 + 成本刻度 + 8px 圓點 + 下方 `成本 X ｜ 現價 Y` | 純文字 `成本 → 現價` | ❌（`_ui/PriceTrack.tsx` 未接） |
| **刪除策略散文** | 仍在同層渲染 `decText`（決策/策略 fallback） | ❌ |

### D. 頁腳（`_ui/holdingCard/HoldingCardFooter.tsx`）
| 規格 §3.4 步驟 4 | 現況 | 判定 |
|---|---|---|
| `今日 +423 ｜ 市值 9,457`（中文一行） | 兩欄格線＋`TODAY`/`VALUE` 英文欄名 | ❌ |
| **刪除價格來源徽章**（移入抽屜 title） | Footer 仍渲染 `srcBadge`（截圖/即時/失敗…） | ❌ |
| Footer 不含目標價 | `feature` 卡仍顯示 `TGT ±%` | ❌ |

### E. 其它連動（正確項，維持不動）
- Hero（`HoldingsHero.tsx`）：與 §3.1 一致，保留。
- 今日待辦（`HoldingsActionPriority.tsx`）：與 §3.2 一致，保留。
- 產業分佈 / 決策書抽屜：本輪不列入，若需要再拆下一批。

---

## 修正方案（本輪只動持倉卡四層）

**S1 · HoldingCardHeader**
- 移除 sparkline block（`.wb-spark` 保留為 hidden placeholder 以維持 e2e 選擇器契約，或改由抽屜 §4.2 承擔——先隱藏＋加 `aria-hidden`，不刪 DOM 節點以免打壞 `holding-card-price-track-parity.spec.ts`；抽屜側後續補）。
- 移除 `× N 股`、`策略 tag`、`教學徽章`、`回報 →` 節點；`onReportMeta` 改由抽屜承接（先保留 prop、暫時 no-op 在卡）。
- 將 `EXIT/REVIEW/HOLD` 英文徽章換成中文樣式：
  - `exit` → 橘底白字「出場」
  - `review` → 橘框橘字「檢視」
  - `hold` → **不渲染任何徽章**
- 徽章統一走 `_ui/ActionBadge.tsx`（已在 `HoldingsActionPriority` 使用），保持一致。

**S2 · HoldingCardReturn**
- 保留大字 ROI，但在其下加入 `<ReturnBar pct={pctVal} scale={40} />`（`_ui/ReturnBar.tsx`）。
- feature 卡的附屬損益數字保留（規格未禁止且抽屜也有相同資料，屬視覺補足）。

**S3 · HoldingCardPriceTrack**
- 用 `<PriceTrack cost={h.cost} now={h.price} />`（`_ui/PriceTrack.tsx`）取代目前的 `成本 → 現價` 文字列。
- **完全刪除 decText 區塊**（策略／決策散文）——規格明列刪除。`meta.strategy` / `dec.actionText` 在抽屜 §4 已有位置。

**S4 · HoldingCardFooter**
- 版型改為單列 `今日 {+/-N} ｜ 市值 {N}`（中文欄名，`｜` 為 U+FF5C 全形）。
- 保留 `.wb-bottom` / `.wb-bottom-val` class name 契約，但重寫內容。
- **刪除 `srcBadge` / `errBadge` / `TGT` 節點**——`srcTitle` 字串改由 `HoldingCard.tsx` 傳給抽屜（本輪只把 footer 上的移除，抽屜對接列在下一輪）。
- 為避免 `holding-card-footer-parity.spec.ts` 崩潰，先把 `data-src-*` 屬性放在 `.wb-bottom` 容器上（keep e2e hooks），DOM 元素本體移除。

**S5 · 憲法保護**
- 保留 e2e class 契約：`wb-card`、`wb-card-feature`、`wb-span-feature`、`wb-span-1`、`wb-spark`、`wb-tags`、`wb-roi`、`wb-bottom`、`wb-bottom-val` 全部維持（依需要以 hidden 節點保底）。
- 保留 `WB` accent / `alpha` token；不新增顏色。
- 保留 `syncState` 三段 overlay/error/sr-status。
- Storage / callback prop signature 不動，避免 `HoldingsTab` 呼叫端連帶改。

**S6 · 驗證**
- 重跑：`e2e/holding-card-price-track-parity.spec.ts`、`e2e/holding-card-footer-parity.spec.ts`、`e2e/freecheckup-card-*.spec.ts`、`e2e/freecheckup-sparkline-*.spec.ts`、`e2e/holdings-*` 全套。
- 手機／桌機截圖比對規格 §3.4：
  - 條軌是否 8px、破表 ▸ 是否出現於 |pct|>40。
  - 價格軌圓點顏色與規格一致。
  - Footer 中文欄名、無 src badge、hold 卡無徽章。
- 依照 `mem://qa/checkup/freecheckup-mobile-regression-checklist` 跑 560／390／380px。

---

## 技術細節（給工程審閱）

- 檔案異動：
  - `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardHeader.tsx`
  - `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardReturn.tsx`
  - `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardPriceTrack.tsx`
  - `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx`
  - `src/checkup/components/freecheckup/HoldingCard.tsx`（改層次注入 props；仍保留 `_ui/holdingCard/*` 分層）
- 不動：`HoldingsHero.tsx`、`HoldingsActionPriority.tsx`、`HoldingsTab.tsx`、`FreeCheckup.jsx`、任何 `_freeCheckup/constants.jsx` 硬合約字串。
- ActionBadge 統一：確認 `_ui/ActionBadge.tsx` 已支援 `kind='exit'|'review'`；若無 `hold` 分支就不宣告，符合「HOLD 不標」。

## 明確不做（本輪範圍外，等下一輪）

1. 抽屜 §4（`HoldingsDetailPanel.tsx`）承接卡頭抽掉的 sparkline／股數／價格來源。
2. 產業分佈 §3.3 的索引三欄與集中度編輯註記細調。
3. 其他分頁（收盤、事件、上傳、記錄）§6 的深度改寫。

如同意，回覆「照做」我就進 build mode。若你要把抽屜對接一併做進本輪，請說明，我把 S5 擴到 §4。
