# 上傳 + 交易日誌 P0–P3 全套優化

審讀後我會分四層落地，**單一 commit** 完成。改動聚焦在這幾個檔案：

```
新檔  src/checkup/lib/imageProcess.js          HEIC + 壓縮
新檔  src/checkup/lib/tradeLogOps.js           日誌 CRUD / 持倉回滾 / CSV
改   src/checkup/hooks/useTradeCaptureRuntime.js
改   src/checkup/components/trade/TradePanel.jsx
改   src/checkup/components/log/LogPanel.jsx
改   src/checkup/lib/tradeParseUtils.js         id 改字串、time fallback
改   src/checkup/hooks/useRouteLogPage.js       多帶 setHoldings/setTradeLog
+ 安裝 heic2any (已預先安裝)
```

—

## P0：資料正確 / 雙寫風險

1. **`parseShot` 改打 `checkup-parse`（vision 端點）+ 走 `callEdge`**  
   目前 `useTradeCaptureRuntime.parseShot` 用 `fetch(API_ENDPOINTS.ANALYZE)` 直打文字端點 `checkup-analyze`，沒有圖、不符合 schema。改成 `callEdge('checkup-parse', { body: { systemPrompt: PARSE_PROMPT, base64, mediaType } })`：
   - 自動帶 user JWT → server 端 `consumeCheckupQuota` 才能正確扣免費版額度。
   - 收到 `data.quota` 後呼叫 `applyQuotaFromResponse(data)` 同步前端配額。
2. **前置 quota gate**：`parseShot` / `runBatchParse` 開頭看 `hasQuota`，沒額度直接彈 toast＋升級 CTA，不浪費頻寬。
3. **id 改字串、避免碰撞**：`buildTradeLogEntries` 的 `Number(\`${ts}${index}\`)` 改成 `\`t-${ts}-${index}-${randomBase36}\``，並把 `LogPanel` 的 sort tiebreaker 換成 `b.id.localeCompare(a.id)`。
4. **submit 防雙擊**：`useTradeCaptureRuntime` 加 `isSubmittingRef`，`submitMemo` 先檢查、寫入後 release；`undoLastSubmit` 同樣加 lock。

## P1：HEIC + 壓縮 + 批次解析

5. **新增 `lib/imageProcess.js`**：
   - `convertHeicIfNeeded`：HEIC/HEIF 動態 import `heic2any` 轉 JPEG。
   - `compressImage`：canvas 重繪到長邊 1600px、JPEG 0.85，比原圖大就放棄壓縮。
   - `preprocessForUpload = convert → compress`。
6. **`enqueueFiles` 整合**：`partitionUploadFiles` 接受 HEIC（不再直接 reject）→ 對 accepted 跑 `preprocessForUpload` → 失敗的歸入 rejected 列表。`tradeUploadGuards` 移除 HEIC 黑名單，改保留 `too-large / not-image / overflow`。
7. **批次解析按鈕**：`TradePanel` 增加「全部解析（{N}）」按鈕，呼叫 `runBatchParse`，內部 `for…of` 序列跑（避免 burst 429），逐張更新 status；單張的「解析目前這張」保留。

## P2：交易日誌大改版

8. **新檔 `lib/tradeLogOps.js`**：
   - `reverseTradeOnHoldings(holdings, trade)`：反向套用一筆已寫入的交易（買→減 qty 並用反向加權平均回推 cost；賣→補回 qty，cost 走當下還原舊值或保留現 cost）。把現有 `applyTradeEntryToHoldings` 的反操作集中於此。
   - `tradeLogToCSV(rows)`：UTF-8 BOM + 欄位 `日期, 時間, 動作, 代碼, 名稱, 股數, 價格, 金額, 備忘1, 備忘2, 備忘3`。
   - `groupByDate(rows)`：依 `date` 分桶，同日內新到舊。
9. **`LogPanel` 重做**：
   - 新增頂部工具列：搜尋（code/name）、買賣 filter、日期區間、CSV 匯出、「展開／收合全部」。
   - 內容改用日期 group + sticky header；同日小計（買 N 筆／賣 N 筆／淨流入 ±NTD）。
   - 每張交易卡右上加 ⋮ menu：**編輯備忘**（彈窗改 `qa[].a`，重新 `setTradeLog`）；**刪除這筆**（confirm dialog → 從 tradeLog 拔除 + `setHoldings(prev => reverseTradeOnHoldings(prev, log))`，並 toast 「已刪除並回滾持倉」）。
10. **`useRouteLogPage` 改 hook 傳遞**：除了 `tradeLog` 還要從 `usePortfolioRouteContext` 取出 `setTradeLog`、`setHoldings`、`flashSaved` 給 LogPanel。

## P3：小修

11. `tradeParseUtils.normalizeTradeRow`：`time` 為空時填 `00:00`（避免排序塌底）。
12. `TradePanel` 的 dropzone：`document.getElementById('fi')` 改 `useRef + useId`，避免兩處共用 dropzone 撞 id。
13. `tradeDate` input：onBlur 跑 `normalizeTradeDate`，無效顯示紅框 + 錯誤訊息（沿用 `C.amber`）。
14. 解析錯誤訊息卡片：背景與文字色從 `C.up`（紅／漲色）改成 `C.amber` 系列，避免與「漲」的語義對撞（符合單色橘憲法）。
15. 預覽圖加「點擊放大」（簡單 `position: fixed` lightbox，無需新元件庫）。

—

## 風險與守則

- **單色橘憲法 + 持倉看板 RWD**：本次改動不影響 Hero/`.wb-card`，不需跑 mobile playwright 套件，但 LogPanel 新工具列需手動 pre-check 380/390/560px（用既有 `scripts/check-freecheckup-rwd.mjs` 流程）。
- **Demo 守門**：`isDemo` 路徑保持「上傳被擋、AI 不打」現狀；P0-1 的 callEdge 不會破壞 demo（demo 模式根本不會走到 parseShot）。
- **檔名不更動**：`useTradeCaptureRuntime` 維持 export 介面，避免影響 `useRouteTradePage`。

—

## 驗收清單

- [ ] iPhone 上傳 HEIC → 自動轉 JPG → 解析成功，無「請改 JPG」彈窗。
- [ ] 8MB 截圖上傳實際 payload < 1.5MB（DevTools Network）。
- [ ] 免費版用完額度，按解析→直接彈升級 CTA，沒打 edge。
- [ ] 連點兩下「完成備忘」只寫入一份成交。
- [ ] LogPanel 搜尋 / 篩選 / 匯出 CSV 正常；刪除某筆會同步回滾 holdings 數量與成本。
- [ ] 同毫秒提交的多筆成交 id 不衝突（看開發者工具 React keys 無 warning）。
