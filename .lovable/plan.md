
# 補完成交上傳 / 解析 gate（這次不再漏）

## 為什麼上次沒修好（直接認）
我上次只清掉 `useTradeCaptureRuntime.js` 的 `hasQuota === false`，但 **FreeCheckup.jsx 的 `parseShot()` 自己又再加了一條前端 quota gate**，把 line_free 用完的人擋在 edge 之前。後端 `checkup-parse` 本來就是 auth-only 不扣 quota，這條前端 gate 就是矛盾來源。截圖裡那行「AI 健檢配額已用完，請查看升級方案」就是它丟出來的 toast。

## 全範圍盤點（這次完整列）
| 位置 | 動作 | 現況 | 應該 |
|---|---|---|---|
| `src/pages/FreeCheckup.jsx` L2319 `parseShot()` L2326-2333 | 截圖解析 | `refreshQuota` → `remaining<=0` → toast 擋 | **拿掉**（截圖解析 auth-only） |
| `src/pages/FreeCheckup.jsx` L2361-2367 | 截圖解析 429 兜底 | OK（後端不會回 429，但保留無害） | 保留 |
| `src/pages/FreeCheckup.jsx` L1714-1724 收盤分析按鈕 | 收盤分析 | `hasReachedDailyLimit` 擋 | **保留**（這條才是 quota 功能） |
| `src/pages/FreeCheckup.jsx` L899 predict 自動觸發 | 預測事件 | 用 quota 擋自動觸發 | **保留** |
| `src/pages/FreeCheckup.jsx` L1938 daily 429 toast | 收盤分析 | OK | 保留 |
| `src/checkup/hooks/useTradeCaptureRuntime.js` | 上傳/解析 | 已修（無 hasQuota gate） | 保留 |
| `src/checkup/components/freecheckup/TradeTab.jsx` L162 banner | 視覺提示 | 有顯示「不影響成交上傳」 | 保留 |
| `src/checkup/components/trade/TradePanel.jsx`（/holding-checkup 入口） | 上傳/解析 | 無 quota gate | OK |

## 要改的檔案
1. **`src/pages/FreeCheckup.jsx`**
   - `parseShot()` 移除 L2327-2333 的 `refreshQuota` + `remaining<=0` 前置攔截
   - 截圖解析改為 auth-only，仍保留下方 429 兜底（防後端規則之後改變時不會炸版）
   - 同時清掉 toast 文案不一致的部分（「AI 健檢配額已用完」放在錯誤情境）

2. **`src/test/unit/trade-upload-gate.test.ts`**
   - 新增測試斷言：`src/pages/FreeCheckup.jsx` 內不可在「截圖解析」路徑上出現 `hasReachedDailyLimit` 或 `remaining\s*<=\s*0` 的前端攔截
   - 斷言：toast 訊息「AI 健檢配額已用完」**不可** 出現在 `parseShot` 函式範圍內
   - 維持原有 6 條鎖規則

3. **`.lovable/plan.md`**
   - 更新已修紀錄 + 標註「截圖解析 = auth-only」入正式憲法

## 驗證（窮舉，不挑樣本）
- `rg "hasReachedDailyLimit|remaining\s*<=\s*0" src/pages/FreeCheckup.jsx`：確認只剩在「收盤分析」與「predict 自動觸發」兩處
- `rg "AI 健檢配額已用完" src/pages/FreeCheckup.jsx`：確認只剩在收盤分析 429 兜底（L1938），不再出現在 parseShot 區塊
- `bunx vitest run src/test/unit/trade-upload-gate.test.ts`：新規則綠燈
- `bunx vitest run src/test/unit/checkup-quota-display.test.tsx src/test/unit/daily-tab-line-free-copy.test.tsx`：既有 quota 顯示 / line_free 文案不退步
- 手動回歸：line_free 已用完帳號 → 上傳截圖 → 按「解析」→ 應正常呼叫 `checkup-parse` 並進入持倉編輯（不再出現「AI 健檢配額已用完」toast）；按「收盤分析」→ 仍正確被擋

## 完成標準
line_free 用完 / tier=none / 補償會員：可上傳 **且可解析** 成交、可建立持倉、可寫日誌；**只有**「收盤分析 / predict-events」會被 quota 擋。
