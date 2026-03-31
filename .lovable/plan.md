
目標：徹底清查為什麼「免費健檢」明明改了很多檔案，但畫面和資料幾乎沒變，並給出可執行的修正方案。

1. 已查到的核心原因
- `/free-checkup` 確實是走 `src/pages/FreeCheckup.jsx`，不是跑錯頁面。
- 但這頁目前仍是單一 2756 行的大檔，幾乎全部用 inline style，所以「改全域樣式」只會影響很少部分，視覺上不會大變。
- Demo 模式的資料來源不是 `seedData`，而是 `src/checkup/data/demoData.js` 的 `DEMO_HOLDINGS`，目前只有 5 檔。
- `FreeCheckup.jsx` 雖然在 Demo 模式寫了 `setHoldings(demoData?.holdings || SEED_HOLDINGS)`，但 `demoData.holdings` 一定存在，所以永遠優先吃 5 檔假資料，不會掉到 20 檔 `SEED_HOLDINGS`。
- 網路請求也證實目前實際寫進雲端的 `pf-holdings-v2` 只有 5 檔：2330、2454、2317、2382、3443。
- 你問的「短中長期」也沒有真正接上：`seedData.js` 有 `STOCK_META.period`，但 `FreeCheckup.jsx` 根本沒使用 `STOCK_META`，畫面只在顯示 `h.type`（股票/ETF/權證），所以你看不到每檔的短/中/長。
- 主題色雖然有改 `src/checkup/theme.js`，但 `FreeCheckup.jsx` 裡仍殘留很多舊色碼與局部字體設定，例如 `TYPE_COLOR` 仍是舊莫蘭迪色、頁面本身還硬寫 `DM Sans`，因此整體視覺只會局部變化，不會徹底變成你要的專業極簡財經感。

2. 為什麼會有「改很多檔案但沒感覺」
- 改的是全域 theme / index.css，但這頁主要靠 inline style 控制。
- 改的是 `seedData`，但 Demo 模式實際吃的是 `demoData`。
- 有些雲端同步會把目前的 5 檔資料再次寫回 `checkup_storage`，所以即使 seedData 變豐富，也會被現行資料流覆蓋。
- 「短中長期」資料存在於 metadata，不在 holdings 主資料內，若不在 render 時 merge，就完全不會出現在 UI。

3. 建議實作方向
A. 先修資料來源，讓 Demo 模式真的顯示完整內容
- 把 `CheckupModeContext.jsx` 的 demo holdings 改為使用 `SEED_HOLDINGS`，或直接讓 `demoData.holdings` 改成完整 20 檔。
- 同步補齊 demo 用的分析、事件、策略大腦內容，避免只有持倉變多，其他面板仍很空。
- 加一層初始化保護：若目前是 Demo 模式，不要把 5 檔舊資料再寫回雲端。

B. 把「短中長期 / 產業 / 策略 / 核心衛星」真正接上畫面
- 在 `FreeCheckup.jsx` 匯入 `STOCK_META`。
- render 每檔持股時，用 `code` 去 merge metadata。
- 顯示至少這幾個 badge：期間（短/中/中長）、產業、策略、部位屬性（核心/衛星/戰術）。
- 若某檔無 metadata，再 fallback 顯示原本 `h.type`。

C. 修正為什麼 UI 改了卻不夠明顯
- 統一移除 `FreeCheckup.jsx` 內殘留的硬編碼舊色值，至少先處理：
  - `TYPE_COLOR`
  - LINE 綠色區塊
  - watchlist 的 `sc` 色碼
  - 局部 button / badge / border 寫死色
- 把頁面字體從內嵌 `DM Sans` 改回跟全站一致的 `Inter + Noto Sans TC`。
- 先不全面重寫元件，但要抽出幾組共用樣式常數：
  - card
  - badge
  - table row
  - section title
  - toolbar button
  這樣你要的「專業、財經、極簡」才會一致，不會東一塊西一塊。

4. 我建議的修正順序
- 第 1 步：修 Demo 資料來源，確保不是 5 檔而是完整 20 檔以上。
- 第 2 步：把 `STOCK_META` 接到持倉列表，補上短中長期與策略標籤。
- 第 3 步：清掉 `FreeCheckup.jsx` 的舊色碼與局部字體，讓新主題真的生效。
- 第 4 步：檢查 Demo 模式與登入模式的雲端寫回邏輯，避免啟動後又被覆蓋成瘦資料。

5. 技術細節
```text
目前資料流實際上是：

Demo 模式
CheckupModeContext.demoData.holdings
        ↓
FreeCheckup useEffect
setHoldings(demoData.holdings || SEED_HOLDINGS)
        ↓
永遠吃到 demoData.holdings（5檔）
        ↓
auto-save 再寫回 pf-holdings-v2
        ↓
你看到的還是 5 檔
```

```text
你要的正確方向應該是：

Demo 模式
完整 seed/demo holdings（20+）
+ STOCK_META merge
+ richer analysis/brain/events
        ↓
畫面顯示完整持倉與短中長標籤
        ↓
若是 demo，不覆蓋成舊 5 檔資料
```

6. 我接下來會怎麼做
- 精準修 `CheckupModeContext.jsx` 與 `FreeCheckup.jsx` 的 demo 初始化來源。
- 接上 `seedData.js` 的 metadata 到持倉 UI。
- 清理 `FreeCheckup.jsx` 內殘留的舊配色與字體，讓視覺變化真正可見。
- 最後再檢查 Demo/登入兩種模式的雲端同步策略，避免資料被回寫覆蓋。

7. 預期結果
- `/free-checkup` 會真的顯示完整持倉，而不是只有 5 檔。
- 每檔股票會看到短/中/中長、產業、策略、核心/衛星等資訊。
- 視覺會比現在更一致，真正接近專業財經極簡風，而不是只換了部分顏色。
- 之後你再刷新，不會出現「明明改了但像沒改」的狀況。
