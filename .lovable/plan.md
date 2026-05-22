# 返回按鈕異常修正計畫

## 我已確認的問題

這不是你錯覺，現在返回邏輯確實很亂，而且不只一頁。

1. `/account/remittance` 現在用 `navigate(-1)`
   - 這代表它完全吃瀏覽器歷史。
   - 如果你是從提醒 toast、結帳成功跳轉、會員區、甚至持股相關頁面繞進來，上一頁就可能是持股看板或 `/app`，所以按返回就被送回錯地方。

2. App 內很多頁的頂部返回不是「回你剛剛來的地方」，而是「照 breadcrumb 猜上一層」
   - `UnifiedAppLayout.tsx`
   - `SignalsLayout.tsx`
   - `LearningLayout.tsx`
   這三個共用 layout 都是用目前 pathname 算 breadcrumb，再回推上一層；如果沒有明確來源，就 fallback 到 `/app`。

3. 目前整站幾乎沒有一套正式的「來源頁」機制
   - 少數頁面只有 query string（像 `from=account`）
   - 其他頁面不是靠瀏覽器 history，就是靠 breadcrumb 猜
   - 所以一旦你是經過 redirect、toast、登入回跳、guard 提醒進頁，返回就很容易失真

## 修正目標

把「返回」改成**可預期、可控、跟入口一致**：

- 從哪裡進去，就回哪裡
- 沒有明確來源時，才走該頁自己的安全 fallback
- 不再讓瀏覽器歷史或 breadcrumb 猜測決定去向
- 至少把目前會被使用者碰到的 portal / account / app detail 頁全部收斂成同一套規則

## 實作計畫

### 1. 建一個共用返回規則層
新增一個輕量的共用 helper / hook，統一處理：

- 讀取 `location.state.from`
- 讀取既有 query 來源（如 `from=account`）
- 決定該頁的 fallback
- 提供 `goBackOrFallback()` 之類的統一 API

這層不直接用 `navigate(-1)` 當主邏輯；`-1` 只保留在極少數明確需要的情境，預設不再依賴它。

### 2. 補上「來源頁 state」傳遞
在會導向下一層頁面的入口，補傳 route state，例如：

- 探索列表 → 專家頁
- 專家頁 → Checkout
- 會員中心 / 訂閱頁 / 提醒入口 → 匯款訂單頁
- 訊號列表 → 訊號詳情
- 週記列表 → 週記詳情
- app 內探索 → 專家詳情

這樣 detail page 的返回會知道自己該回哪個入口，而不是亂猜你是從哪來。

### 3. 先修你現在炸到的重災區
優先處理這些已確認有風險的頁：

- `src/pages/account/MyRemittanceOrders.tsx`
  - 拿掉 `navigate(-1)`
  - 改為：有明確來源就回來源，否則回 `/account/profile` 或 `/app/account`（依實際入口決策）

- `src/pages/app/SignalDetail.tsx`
  - 現在也是 `navigate(-1)`，改成固定回訊號列表來源

- `src/components/layouts/UnifiedAppLayout.tsx`
- `src/components/layouts/SignalsLayout.tsx`
- `src/components/layouts/LearningLayout.tsx`
  - 把現在「breadcrumb 推上一層」改成「優先吃來源 state，沒有才用 breadcrumb fallback」

### 4. 補齊 remittance 流程的回來路徑
把匯款相關入口全部補成同一套：

- Checkout 建單成功跳去 `/account/remittance` 時，帶來源 state
- Profile 的「我的匯款訂單」入口帶來源 state
- App Account banner 的「前往補填」帶來源 state
- PendingRemittanceGuard toast 的「前往補填」也帶來源 state

這樣匯款頁的返回就不會再隨機回持股或其他地方。

### 5. 盤點並修掉其他仍在用 `navigate(-1)` 的頁面
目前我已確認至少這兩個直接中槍：

- `src/pages/account/MyRemittanceOrders.tsx`
- `src/pages/app/SignalDetail.tsx`

我會把所有使用者可見的返回按鈕再掃一輪，只保留少數真的應該依賴原生 history 的情境，其他都改成明確導向。

### 6. 驗證
我會針對以下情境逐一驗：

- 專家頁 → Checkout → 匯款頁 → 返回
- 會員中心 → 我的匯款訂單 → 返回
- App Account banner → 匯款頁 → 返回
- toast 提醒 → 匯款頁 → 返回
- 訊號列表 → 訊號詳情 → 返回
- app 內探索 → 專家詳情 → 返回
- 登入後回跳再進 detail 頁時，返回仍正確

## 技術細節

### 會動到的檔案
- `src/pages/account/MyRemittanceOrders.tsx`
- `src/pages/app/SignalDetail.tsx`
- `src/components/layouts/UnifiedAppLayout.tsx`
- `src/components/layouts/SignalsLayout.tsx`
- `src/components/layouts/LearningLayout.tsx`
- `src/pages/account/Profile.tsx`
- `src/pages/app/Account.tsx`
- `src/components/PendingRemittanceGuard.tsx`
- `src/pages/Checkout.tsx`
- 視掃描結果，補幾個入口頁（例如 `ExpertProfile.tsx`、`AppExplore` 相關入口）

### 不會動的範圍
- 後端
- 匯款訂單資料結構
- 對帳流程
- 付款邏輯本身

## 預期結果

修完後，返回按鈕不會再「莫名其妙掉回持股看板」，而是會穩定回到使用者實際進入該頁的入口；匯款頁、訊號詳情、會員區 detail 頁都會一致。