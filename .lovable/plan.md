# 修正計畫：把「成交上傳」從「收盤分析額度」完全拆開

## 問題已確認
目前程式裡有**互相矛盾的 gate**，這就是你看到的錯誤行為來源：

1. **權限定義寫的是：已登入就能上傳成交**
   - `src/checkup/contexts/CheckupModeContext.jsx`
   - 這裡明寫：`canUpload = mode !== 'demo'`
   - 註解也明寫：**配額只限制 AI 呼叫，不限制資料輸入**

2. **但成交流程實作卻拿 daily quota 直接擋掉**
   - `src/checkup/hooks/useTradeCaptureRuntime.js`
   - `enqueueFiles()` 與 `parseUploadById()` 都有 `hasQuota === false` 就直接擋
   - 所以只要收盤分析額度用完，成交上傳/解析也一起被封

3. **Trade UI 也被綁到收盤分析額度**
   - `src/checkup/components/freecheckup/TradeTab.jsx`
   - `src/pages/FreeCheckup.jsx`
   - 目前 `hasReachedDailyLimit` 會直接把「上傳成交」整區改成升級／配額用盡提示
   - 這等於把「上傳成交」錯誤當成「收盤分析訂閱功能」

4. **但後端成交解析其實本來就是 auth-only，不扣 quota**
   - `supabase/functions/checkup-parse/index.ts`
   - 用的是 `requireCheckupAuth()`，不是 `consumeCheckupQuota()`
   - 也就是：**後端本來允許已登入者解析成交，前端卻自己多擋了一層**

## 我要做的修正

### 1. 重新切清三種權限，不再混用
把 checkup 權限拆成三條獨立規則：

- **成交上傳**：只看是否已登入 / 非 demo
- **成交解析**：只看是否已登入（沿用現有 edge auth-only 規則）
- **收盤分析 / predict-events**：才看訂閱、補償、每日/每週/每月額度與時間窗

這樣舊會員、補償會員、LINE 註冊禮、一般已登入會員，都不會再因為「收盤分析額度」被連帶封死成交上傳。

### 2. 修正前端所有錯誤 gate 點
會一起改完整範圍，不只改一個按鈕：

- `src/checkup/hooks/useTradeCaptureRuntime.js`
  - 移除 `hasQuota === false` 對成交上傳/解析的封鎖
  - 改成只在 `isDemo` / 未登入情境擋下
- `src/checkup/components/freecheckup/TradeTab.jsx`
  - 不再用 `hasReachedDailyLimit` 隱藏上傳區或顯示錯誤升級文案
  - 已登入但分析額度用完者，仍可正常上傳成交
- `src/pages/FreeCheckup.jsx`
  - Trade tab 傳入的 gate 改成 upload/auth gate，不再共用 daily gate
- 若 `/holding-checkup` 主路由也有同類判斷，會同步整理，避免兩套頁面再次分裂

### 3. 對齊「舊會員 / 補償會員」業務規則
我會把這次規則固定成一致行為：

- **補送的收盤分析權利** 只影響收盤分析本身
- **成交上傳與持倉建立** 不能再被補償方案或 daily quota 牽連
- 若程式內還有其他 legacy/補償判斷（例如 `line_free_gift`、舊會員補償流），會一併檢查是否被誤接到 trade flow

## 會改的檔案
- `src/checkup/contexts/CheckupModeContext.jsx`
- `src/checkup/hooks/useTradeCaptureRuntime.js`
- `src/checkup/components/freecheckup/TradeTab.jsx`
- `src/pages/FreeCheckup.jsx`
- 視實際串接需要，補改：
  - `src/checkup/hooks/useRouteTradePage.js`
  - `src/checkup/hooks/useAppRuntimeComposer.js`
  - `src/checkup/hooks/useAppRuntimeWorkflows.js`

## 自動化測試會補到的範圍
我會補**完整回歸**，避免之後又把成交上傳跟分析額度綁回去：

1. **runtime gate 測試**
   - 已登入 + `hasQuota=false` → 仍可上傳成交
   - demo / 未登入 → 仍然要被擋

2. **TradeTab UI 測試**
   - `tier=none` 且已登入 → 要看到上傳成交，不是「收盤分析為訂閱功能」
   - `line_free` 已用完 → 收盤分析可鎖，但成交上傳不可鎖
   - `basic/pro` 額度耗盡 → 成交上傳仍可用

3. **edge / 合約測試**
   - `checkup-parse` 維持 auth-only，不消耗 quota
   - `checkup-analyze` 仍維持 consume quota
   - 確保兩者權限模型分離

4. **雙入口回歸**
   - `/checkup` 的 Trade tab
   - `/holding-checkup` / route trade page
   - 兩邊行為一致

## 完成後的正確結果
修完後會變成：

- **舊會員 / 補償會員 / 已登入會員**：都能上傳成交、建立持倉、寫交易日誌
- **收盤分析額度用完**：只會擋收盤分析與其衍生配額功能，不會再擋成交上傳
- **訪客 / demo**：仍然不能上傳成交

## 技術細節
```text
Auth gate
  └─ trade upload / trade parse
      = authenticated only

Quota gate
  └─ daily analysis / predict-events / paid AI quotas
      = subscription + quota + time-window rules

這兩條不能再共用 hasReachedDailyLimit / hasQuota
```
