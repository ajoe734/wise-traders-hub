## 目標
把 `/holding-checkup` 的「產業分佈 / 題材曝險 / 策略」三區，從原本的 chip 橫向排列改成「Modular editorial grid」方向，讓數據更有編輯感、不再呆板。

## 修改範圍
只動 `src/checkup/components/freecheckup/HoldingsSectorSummary.tsx`，不更動資料語意與互動行為。

## 具體改動

### 1. 區塊容器
- 移除 `borderLeft` 裝飾線與 `background` 底色，改為純留白分界。

### 2. 產業分佈
- 標題列左放「產業分佈 (依市值)」、右放「集中警示」小標籤。
- 移除原水平堆疊色條，改為 grid：
  - 每格上方大號百分比（22px / 500），
  - 下方產業名稱 + 檔數，
  - 點擊整格 toggle 篩選條件，
  - 已選狀態用邊框 + 小點標示，不使用實色填充。
- 集中警示文字區改以 `C.border` 上下線 + `C.textMute` 呈現，符合設計憲法（不用 amber 作狀態色）。

### 3. 題材曝險
- 改用帶細邊框的 tag，內含名稱與檔數，點擊 toggle。

### 4. 策略
- 改用「小圓點 + 名稱 + 檔數」的清單式排列，點擊 toggle。

### 5. 預設列細節清理
- 移除預設 highlight 的 `boxShadow`，其餘預設 UI 維持現狀。

## 不會改動
- 資料計算邏輯（`aggregateBySector`）。
- 篩選交互（toggle / 聯集 / 交集 / 清除 / 存為預設）。
- 其他頁面或元件。

## 驗證
- 本地 Vite 建構通過。
- 預覽確認三區視覺正確、點擊仍可篩選、警示區保留。