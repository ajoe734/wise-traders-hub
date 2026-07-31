# 持倉抽屜：佔比排名區塊改為「最下方 + 可摺疊 + 可排除匯出」

## 目標

抽屜裡的「佔比／排名 #x ／ N」條狀圖：

1. 移到抽屜內容最下面（在情境模擬、論點引文之後），不再夾在走勢帶與決策履歷中間。
2. 預設摺疊，只顯示一行標題列（`佔比　排名 #3 ／ 12`），點一下展開條狀圖，展開狀態會記住。
3. 匯出選單多一個「包含佔比排名」開關，關掉時匯出卡不輸出佔比資料。

## 行為細節

- 摺疊標題列本身就帶排名資訊，收起時仍看得到自己排第幾。
- 展開／收合狀態存在抽屜偏好裡，下次開抽屜維持上次選擇（預設收合）。
- 匯出開關預設「包含」，關閉後匯出卡的「部位佔比」欄位不出現（1:1 與 16:9 兩種版型都一致）。
- 匯出開關與現有比例／格式／解析度一樣存在匯出偏好，重開仍保留。

## 技術做法

- `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
  - 將 `<WeightRank>` 從區塊 7 移到區塊 10（論點引文）之後，成為內容區最後一段。
  - `WeightRank` 改為可摺疊：標題列做成 `button`（`aria-expanded`），下方條狀圖依狀態渲染；沿用 `data-testid="holdings-weight-rank"`，標題列加 `data-testid="holdings-weight-rank-toggle"`。
  - 傳入 `weightPct` 給匯出卡時，依匯出偏好決定是否傳 `null`。
- `src/checkup/lib/drawerPrefs.ts`
  - `HoldingPanelPrefs` 新增 `weightRankOpen: boolean`（預設 `false`）；sanitize 已是布林轉換，無需改結構。
  - `HoldingExportPrefs` 新增 `includeWeightRank: boolean`（預設 `true`），並在 sanitize 中做布林正規化與舊資料 fallback（缺欄位時視為 `true`）。
- `ExportMenu` 在「解析度」之後、匯出按鈕之前，新增一個 checkbox 列「包含佔比排名」，`data-testid="export-toggle-weight-rank"`。
- `HoldingExportCard.tsx` 不需改邏輯（`weightPct == null` 時本來就不渲染該列）。

## 測試

- `src/checkup/lib/drawerPrefs.test.ts`：新增 `includeWeightRank` 預設值、舊 localStorage 缺欄位 fallback 為 true、非布林值被正規化的案例。
- 單元／E2E：抽屜開啟後佔比區塊預設收合、點擊展開、位置位於抽屜內容末段；匯出開關關閉後匯出卡不含「部位佔比」。
- 既有抽屜回歸：`bunx playwright test e2e/holdings-detail-panel-narrow.spec.ts` 與 checkup 相關單元測試。
