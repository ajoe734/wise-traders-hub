# Batch C · §6 其他分頁：結構與路由改版

依 `.lovable/DESIGN_HANDOFF.md` §6，接續 §3.3 產業分佈的編輯化語彙（serif 節標 + 髮絲線 + 純文字索引 + 零色卡零 emoji），把 §6.1–§6.5 逐一改造。**此批次只動視覺／結構／路由，商業邏輯（AI 分析、行事曆同步、批次解析、去重、備忘三問、勝率統計、Demo/LINE 提示邏輯）全數保留**。

---

## 1. 頂欄 / 路由（`src/pages/FreeCheckup.jsx`）

**現況**：TABS = 持倉 / 收盤分析 / 事件 / 記錄 4 tab（已對齊 §2），「＋ 上傳」按鈕呼叫 `setTab('trade')` 切到 trade 分頁；`tab==='news'` 仍靠內部 setTab 觸發。

**改動**：
- 新增 `uploadModalOpen` state，「＋ 上傳」（桌機 + 手機圓鈕）改為 `setUploadModalOpen(true)`，不再 setTab。
- `tab==='trade'` 區塊改成用 `<TradeUploadModal>` 包一層，只在 `uploadModalOpen` 時掛載；成功後呼叫 `setUploadModalOpen(false)` 並 `setTab('holdings')`（沿用既有 flow）。
- `tab==='news'` 區塊整段刪除；`NewsTab` 的顯示由 `EventsTab` 內兩態切換承接。
- `TABS` 標籤：`收盤分析→收盤`、`事件${…}`、`記錄` — 對齊 §6 報頭字。
- 相容：保留 `setTab` 對 `trade/news/research` 的呼叫路徑，但視覺入口拿掉；`research` tab 目前無入口，維持隱藏渲染。

## 2. §6.1 收盤分析（`freecheckup/DailyTab.jsx`）

- 報頭：serif `收盤分析` 22px + 右側 `YYYY/MM/DD · 今日餘 N 次`（tabular-nums）。
- 分析文：serif 15–16 / 行高 2；段落間 12px；引文塊改為左 1px 髮絲。
- 個股清單：三欄 grid `名稱｜漲跌%｜一句判斷`（判斷內的動詞用 accent）；欄距用 24px；每列底 1px `--hair`。
- 頁腳：`歷史日期 · 重新分析 →`（連結色 = ink，hover accent）。
- **刪除**：置中大按鈕、字距英文小標、teal 色塊、所有 emoji。
- **保留**：`runDailyAnalysis / analyzing / analyzeStep / dailyLastError / handleDailyRetry / analysisHistory / coverageReport / strategyBrain` 全套資料流；配額耗盡態改為一行 `今日餘 0 次 · HH:MM 重置`。

## 3. §6.2 事件 + 新聞驗證合併（`freecheckup/EventsTab.jsx`）

- 報頭：serif `事件`；右上兩態 pill toggle：`未來 N ｜ 已驗證 N · 命中率 x%`（狀態存 `mode: 'upcoming' | 'verified'`）。
- **未來列**（原 EventsTab 資料）：`serif MM/DD｜型別灰字 10px｜摘要 13px｜預測漲(accent)/待觀察(mute) 尾註`。
- **已驗證列**（原 NewsTab review 資料）：`serif MM/DD｜摘要｜命中(accent)/未中(mute) + 事後 ±%`。
- 讀取 `NewsTab` 需要的 props（`newsEvents / stableStartReview / stableSubmitReview / reviewForm / reviewingEvent` 等）直接由 `FreeCheckup.jsx` 一次傳給 `EventsTab`。
- Debug／同步狀態：⟳✓⚠ 徽章牆刪除，改為 `更新於 HH:MM · 立即更新 →` 一行；長按或 `?debug=1` 打開既有 debug 面板（`debugPanelOpen` state 保留）。
- 刪 `TYPE_COLOR` 八色 chip、統計三色卡、五色輪替卡底。

## 4. §6.3 上傳成交 modal（新 `freecheckup/TradeUploadModal.jsx` 包 TradeTab）

- 新元件 `TradeUploadModal.jsx`：`{open, onClose, ...tradeProps}`；置中 modal（max-width 560、border 1px ink、遮罩 `rgba(10,10,10,0.18)`）。
- Header：serif `上傳成交` + `今日餘 N 次 · 18:00 重置`。
- Body：虛線框 `1px dashed --hair-strong` 投遞區，hover / dragover 轉 accent；下方保留既有批次列表、備忘三問、目標價手動輸入。
- Footer：`手動輸入目標價 →｜上次上傳 HH:MM · X 筆`。
- 內部直接 render `<TradeTab {...}/>` 避免搬 643 行邏輯，只在外層套 modal chrome 與新 header/footer；`TradeTab` 內部視覺樣式維持（改版留給下一輪 C2）。
- 成功回呼：解析成功 / 匯入 holdings 後自動 `onClose()` + `setTab('holdings')`。
- ESC / 背景點擊 / 右上 `×` 三種關閉；`aria-modal`、focus trap、`data-testid="trade-upload-modal"`。

## 5. §6.4 交易記錄（`freecheckup/LogTab.jsx`）

- 移除 Demo LINE 提示框（移到頁腳一行，§6.5 承接）。
- 日期節標：serif 15px `YYYY/MM/DD ・ 週三`（Taipei tz）。
- 每筆：`買進(accent)/賣出(--loss) 一字 + 名稱代號 · 時間 · N 股 @ 價`。
- 問答：引文塊改左 1px 髮絲 + serif 內文；未填 → `--ink-faint` 「（未留筆記）補寫 →」（點擊回填目前無 handler，先以 `href="#"` + `data-testid="log-fill-memo"` 佔位，後批次接 modal）。
- 空狀態：serif 一行 `還沒有交易記錄` + 次行 `上傳成交截圖後自動記錄在這裡`。

## 6. §6.5 一次性引導（`freecheckup/OnboardingOverlay.jsx`）

- 新元件：首次進站全屏卡（`localStorage.getItem('lf.checkup.onboarded')` 判斷）。
- 內容：serif 22px 標題 `三步，把持倉變成每天的決策書` + 三步列 `01 上傳｜02 診斷｜03 決策`（數字 accent）+ `LINE 登入開始 (ink 底)｜先看示範資料 (hair 框)`。
- 關閉後寫入 flag；同時將既有 `DEMO_TAB_NOTICE_COPY` 在 Daily/Events/Log/Research 各 tab 頂部的 banner 全部隱藏，只在頁腳留一行 `示範資料 · 登入`（新元件 `<DemoFooterHint>`）。
- 保留 `startLineLogin / navigate` 呼叫。

## 7. E2E / 測試

- `e2e/freecheckup-batch-parse.spec.ts` 等 trade 相關 spec：新增 `page.click('[data-testid="checkup-upload-cta"]')` 開啟 modal，之後選擇器不變（TradeTab 內部 DOM 保留）。
- 新增 `e2e/freecheckup-upload-modal.spec.ts`：開啟 / ESC / 背景關 / 成功後自動關並跳持倉。
- 更新 `e2e/freecheckup-tab-prop-schema.test.ts`（若有）以反映 EventsTab 新增的 news props。
- `NewsTab.jsx` 檔案不刪，先掛 `@deprecated`；等下一輪確認 EventsTab 已涵蓋所有情境再刪。

## 8. Plan 更新

`.lovable/plan.md` 批次 C 更新為完工狀態，附本次結構決策；驗收清單勾選 `4 tab＋上傳 modal；事件頁兩態含原新聞驗證資料`、`Demo/LINE banner 全刪只留頁腳一行`。

---

## 產出檔案清單

- 新增 `src/checkup/components/freecheckup/TradeUploadModal.jsx`
- 新增 `src/checkup/components/freecheckup/OnboardingOverlay.jsx`
- 新增 `src/checkup/components/freecheckup/DemoFooterHint.jsx`
- 修改 `src/pages/FreeCheckup.jsx`（路由 / upload CTA / 事件 news 合併掛載 / onboarding overlay 掛載）
- 修改 `src/checkup/components/freecheckup/DailyTab.jsx`（編輯化）
- 修改 `src/checkup/components/freecheckup/EventsTab.jsx`（兩態切換 + 併入 News 驗證列）
- 修改 `src/checkup/components/freecheckup/LogTab.jsx`（編輯化）
- 修改 `.lovable/plan.md`（批次 C 完工註記）
- 新增 `e2e/freecheckup-upload-modal.spec.ts`

## 不動

- `TradeTab.jsx`（內部 643 行邏輯不搬，只由 modal 包裝；視覺改版列入未來 C2）
- `NewsTab.jsx`（暫留 deprecated，資料流已被 EventsTab 承接）
- `ResearchTab.jsx`（頂欄已無入口，隱藏渲染保留給 setTab('research') 內部呼叫）
- Hero / 今日待辦 / 產業分佈 / 持倉卡 / 抽屜（前批完工）
- 所有商業邏輯：AI 分析、行事曆同步、批次解析、備忘三問、勝率統計、Demo 資料
