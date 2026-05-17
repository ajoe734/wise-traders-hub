## 為什麼首頁 Loading 慢

我實際對 `/` 走了一輪程式碼路徑，找到三個明確的瓶頸（與 session replay 觀察到的「先閃 spinner、約 1.4 秒後才出內容」完全吻合）：

### 1. 首頁本身被 lazy-load（最關鍵）
`src/App.tsx:28`
```
const Index = lazy(() => import("./pages/Index"));
```
所有路由（含 `/`）都走 `React.lazy + Suspense`，所以第一次到首頁時：
1. 先下載 main bundle
2. 再下載 `pages/Index` chunk（含 6 張 webp import、VsBrushMark、WeeklyLeaderboard、PortalLayout…）
3. 期間畫面只剩 `RouteFallback` 那顆轉圈圈 → 就是你看到的「Loading」

首頁是流量最高的路由，**不應該**走 lazy，這個多繞一圈的 chunk 下載就是主要延遲來源。

### 2. Hero 影片 4.4MB、`preload="auto"`、沒有 poster
`public/videos/hero-bg.mp4` = **4.4 MB**
`src/pages/Index.tsx:77-88`
```html
<video autoPlay loop muted playsInline preload="auto" ...>
```
- `preload="auto"` 會在頁面一開始就跟 JS chunk / webp 競爭頻寬，拖慢 LCP
- 沒有 `poster`，影片下載前該區是純黑色
- 影片元素本身就是 LCP candidate，影片沒到 = LCP 沒到

### 3. WeeklyLimitUpLeaderboard 立即發 query
`src/pages/Index.tsx:925` 渲染在很下面（要捲動才看得到），但 `useWeeklyLeaderboard()` 在 Index mount 當下就觸發 Supabase 查詢，跟首屏資源搶頻寬。

---

## 修復計畫

### A. 首頁改 eager import（最大效益）
```ts
// src/App.tsx
import Index from "./pages/Index";   // 取代 lazy(() => import("./pages/Index"))
```
其餘路由維持 lazy。代價：main bundle 多 ~Index 的大小，但換掉 Suspense 等待，首屏直接渲染。

### B. Hero 影片改 lazy + poster
- 產生一張 hero poster（webp，約 100KB）放在 `src/assets/hero-poster.webp`
- `<video>` 改：
  - `preload="metadata"`（不抓整支）
  - 加 `poster={heroPoster}`
  - 用 `IntersectionObserver` 或 onCanPlay 在 mount 後才把 `src` 掛上（或用 `<source data-src>` + useEffect 賦值）
- 另外把影片改成 720p / CRF 28 重壓，目標 < 1.5MB（後續再做）

### C. 下方 widget 延遲查詢
把 `WeeklyLimitUpLeaderboardSection` 用既有的 `LazyOnVisible` 包起來（首頁已有此 component），元件不進入視窗就不掛載、不查詢。

### D. 6 張 feature webp 確認尺寸
快速檢查 `feature-xianren / sanpai / jiaodai / five-factions / card-kungfu-*` 的尺寸，超過 200KB 的重新壓縮（webp q=75, max 1200w）。屬於 follow-up。

---

## 預期改善

| 項目 | 現況 | 改後 |
|---|---|---|
| 首屏 spinner | 出現 ~1.4s | 消失 |
| Hero 區黑屏 | 直到 4.4MB 影片載入 | poster 立即出現 |
| 並行請求競爭 | 影片 + 6 webp + leaderboard 同時搶 | 只剩 6 webp + index chunk |

預期 FCP / LCP 改善 600–1500ms（實際數字可以用你剛建好的 `/company/perf-metrics` 儀表板觀察）。

---

## 技術備註

- 不改任何 UI 視覺，純效能優化
- 不動 `prefetchHighTrafficRoutes` 與 `routePrefetch.ts`（上一輪剛做完）
- `LazyOnVisible` 已存在於 `src/components/LazyOnVisible.tsx`
- A 步驟做完後，可再考慮把 `PortalLayout`、`SEO` 也從 Index 拆出共用 chunk，但先不做避免過度優化
