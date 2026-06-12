## 目標

產出一支 20 秒、1920×1080 的 MP4 介紹影片，主打兩大優勢：
1. **AI 自動辨識成交截圖** → 自動寫入持倉
2. **每日收盤一鍵 AI 健檢** → 自動分析風險

同時輸出 9:16 直式版本，方便 FB/IG 廣告投放。

雙用途部署：
- **入口嵌入**：`/holding-checkup` 第一次進入時，在頂部顯示影片播放卡（用 `<video>` 標籤，可關閉、可重看），關閉狀態寫入 localStorage（沿用 `checkup-coach-seen-v1` 旁的新 key）。
- **獨立檔案**：MP4 同時放在 `/mnt/documents/` 供下載，也上傳 `lovable-assets` 作為靜態資產，可直接拿去投放 Facebook / Line。

## 影片結構（20 秒，30fps，600 frames）

```text
0.0–2.5s  Hook：黑底 → legendflow 橘點亮起 → 標題「你的持倉，AI 幫你管」
2.5–7.0s  場景 1：AI 辨識成交截圖
            - 左半 phone mockup：券商成交明細截圖滑入
            - 中間：掃描線由上而下掃過 + OCR 偵測框逐欄高亮
            - 右半：持倉表格欄位逐格填入（股票/張數/成本）
            - 字幕：「丟一張截圖，部位自動建立」
7.0–12.0s 場景 2：每日收盤一鍵健檢
            - 持倉表格停在畫面 → 點下「AI 健檢」按鈕（光暈脈動）
            - 進度條 + 三步驟字幕：讀取部位 → 分析風險 → 產出建議
            - 健檢卡片由下而上滑入，紅色警示標出風險檔
            - 字幕：「收盤一鍵，整體部位健檢」
12.0–16.5s 場景 3：行事曆 + 警示（次要賣點，輕帶過）
            - 行事曆網格淡入，法說/除權息圖示落定
            - 字幕：「事件提早提醒，不再錯過」
16.5–20.0s 收尾：產品 logo + slogan +「立即體驗 → legendflow.tw/holding-checkup」
```

**設計方向**：延續 Kore-eda 極簡風 + legendflow 橘點 (#EC662D)。米色背景 #F5F3EF、深墨字 #1a1a1a、橘色僅作重點。Source Serif 4 標題 + 思源黑體 body。動畫節奏舒緩但有節拍感，避開誇張 spring 彈跳。

**台股色彩規範**：表格內漲跌數字遵守台股慣例（紅漲綠跌），影片中要出現的損益範例就符合。

## 技術實作

### A. Remotion 專案
- 新建 `remotion/` 目錄，獨立 `bun init`，安裝 `remotion`、`@remotion/cli`、`@remotion/transitions`、`@remotion/google-fonts`、compositor 套件。
- `src/Root.tsx` 註冊兩個 composition：
  - `holdings-promo-16x9`：1920×1080，600 frames
  - `holdings-promo-9x16`：1080×1920，600 frames（共用同樣 scene 元件，layout 重排）
- Scene 元件拆 5 個檔案：`Hook.tsx`、`SceneOcr.tsx`、`SceneCheckup.tsx`、`SceneCalendar.tsx`、`Outro.tsx`，用 `<TransitionSeries>` 串接（fade + slide 各用一次，保持節制）。
- 持倉表格 / 截圖 mockup 全部用 HTML/CSS 重繪，**不用真實截圖**（避免洩漏個資、好控制動畫）。Mock 股票用「2330 台積電 / 2454 聯發科 / 2317 鴻海」等公開大型股，數字隨意。
- 字型：`@remotion/google-fonts/SourceSerif4` + `NotoSansTC`，於 module scope `loadFont()`。
- 渲染走程式化腳本 `scripts/render-remotion.mjs`（chrome-for-testing + muted: true），輸出兩支 MP4 到 `/mnt/documents/holdings-promo-16x9.mp4` 與 `/mnt/documents/holdings-promo-9x16.mp4`。

### B. 入口嵌入
- 新建 `src/checkup/components/HoldingsIntroVideo.jsx`：
  - 第一次進入 `/holding-checkup` 時顯示一張卡片，內含 `<video autoplay muted playsinline controls>` + 「不再顯示」按鈕。
  - localStorage key：`holdings-intro-video-seen-v1`。
  - 影片來源走 `lovable-assets` 上傳後的 `.asset.json` URL（兩個尺寸自動依 viewport 切換：mobile 用 9:16，desktop 用 16:9）。
- 掛載點：`FreeCheckup.jsx` 或 `HoldingsPage.jsx` 入口 render 之前（待我在 build 階段確認實際入口檔，目前候選為 `src/pages/FreeCheckup.jsx`）。
- 與既有 `CoachMarks` 並存：影片優先顯示，關閉後才走 CoachMarks。避免兩者同時冒出。

### C. 廣告投放檔
- `/mnt/documents/holdings-promo-16x9.mp4`：YouTube / FB feed / 官網 hero
- `/mnt/documents/holdings-promo-9x16.mp4`：FB / IG Reels / Stories、Line VOOM
- 兩支都附 `<presentation-artifact>` 讓你直接下載。

## QA 與驗證

1. 用 `bunx remotion still` 抽 8 個關鍵 frame（每 2.5 秒一張）視覺檢查：字有沒有切到、橘點位置、表格對齊、9:16 重排是否破版。
2. 完整渲染後再用 ffprobe 確認時長、解析度、codec。
3. 入口嵌入用 Playwright 跑一次：首次進入有卡片 → 按關閉 → reload 後不再出現 → localStorage key 寫入正確。

## 不做的事

- 不錄真實 App 操作畫面（時間成本高、UI 一改就要重錄）。整支用 Remotion 重繪 mockup。
- 不加旁白語音（這版先做無聲 + 字幕，廣告平台多半預設靜音播放）。若之後要旁白，再用 ElevenLabs 加上。
- 不做場景 4「警示推播」單獨一場，併入場景 2 的健檢卡片帶過，避免 20 秒塞不下。

## 待你確認

- 影片 slogan 用「你的持倉，AI 幫你管」OK 嗎？或要換成更直接的「上傳截圖，AI 幫你顧好每一檔」？
- 收尾 CTA 文字要「立即體驗」還是「免費試用」？
- 入口卡片預設要不要自動播放？（目前規劃 autoplay + muted，行動裝置才能 autoplay）
