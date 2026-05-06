## 任務一：移除錯誤的免責聲明

`src/components/layouts/PortalLayout.tsx` 第 233–236 行的 footer 同時印了：
- 公司資訊「© 2026 海洋福星生物科技股份有限公司（統編：83479669）」
- 「投資一定有風險，基金投資有賺有賠，申購前應詳閱公開說明書。」

第二行是基金業用語，與我們「教學平台」定位不符。

**做法**：
- 移除「投資一定有風險…公開說明書」這一行
- 公司名稱與統編是法人識別資訊，建議保留（教學平台仍須揭露營業主體）。如果你希望整段都拿掉，告訴我，我會一併刪掉第 234 行。
- 同步檢查 `src/pages/Legal.tsx` 第 89 行「投資一定有風險，過去的績效不代表未來的表現」這句屬「教學免責」性質，是合理保留的，不動。

## 任務二：首頁載入慢的診斷

首頁 `src/pages/Index.tsx` 自身只有兩個 `useEffect`（輪播 hint 計時），沒有阻塞性 fetch；唯一資料來源是 `useWeeklyLeaderboard`，但它是非阻塞渲染（`isLoading` 由子元件處理）。

可能的真正原因（需實測才能確認）：
1. **首屏資產過大**：Index.tsx 1454 行 + 多張 PNG（`feature-xianren`、`card-kungfu-*` 等）+ embla-carousel + WeeklyLimitUpLeaderboard，全部走主 bundle，沒有 code-split。
2. **字型/外部資源**：`index.html` 預連 Google Fonts（Ma Shan Zheng）+ AppShell 內再 `@import` Inter，FOUT/阻塞。
3. **首頁 query 多重 round-trip**：weekly leaderboard RPC 若慢會拖累互動但不應卡白屏。
4. **Cloud 後端延遲**：若 Lovable Cloud 實例壅塞，所有 supabase 呼叫都會慢。

**做法（按效益排序）**：
1. 用 `browser--performance_profile` + `browser--start_profiling` 實際量測首頁載入瓶頸（LCP、long tasks、最慢的 script / network），先看到數據再下藥。
2. 對 `Index.tsx` 做 **route-level code-split**：把首頁拆成 `lazy()` chunk；把「導師排行榜」「VS 輪播」等下半部 section 改 `React.lazy` + `Suspense`，只在進入 viewport 才載入。
3. 把 hero 之外的圖片改 `loading="lazy" decoding="async"`，並考慮 WebP（目前是 PNG）。
4. 移除 `AppShellFrame.jsx` 內動態 `@import` Inter 字型（已經在 `index.html` preconnect Google Fonts，重複載入會阻塞）。
5. 若量測顯示是後端慢，再依 Lovable Cloud 指引建議升級實例。

## 執行順序

1. 先改 footer（30 秒內完成，立即可見）
2. 進入 default mode 後跑 performance profile，根據實測結果套用第 2–4 點優化
3. 把實測前/後的 LCP、TTI 數字回報給你

## 需要你確認

footer 第 234 行「© 2026 海洋福星生物科技股份有限公司（統編：83479669）」要**保留**還是**一起刪掉**？
