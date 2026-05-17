## 我這次真的去量了，數字如下（preview 環境，剛剛實測）

`/expert/sharkgu` performance_profile：
- **FCP 8776ms**、DOM Interactive 2548ms、DCL 6897ms
- 載了 **144 個 resource**（其中 script 115 個，1.27MB）
- 最慢的個別資源都是「Vite 把整個模組轉譯出來」這層：
  - `src/index.css` 2084ms
  - `recharts.js` 1500ms（220KB）
  - `react-helmet-async.js` 1523ms
  - **`src/pages/auth/Login.tsx` 1283ms**  ← 不該出現在 expert 頁
  - **`src/pages/Pricing.tsx` 1194ms**     ← 不該出現在 expert 頁
- Supabase 端的 5 個查詢全部 < 400ms，**不是 API 慢**

`/app/explore`：
- 命中快取後只剩 2 個 fetch（profile、user_roles），都 < 450ms
- 慢的也是首次進站的 chunk 載入

## 真正的瓶頸（按影響力排序）

1. **`prefetchHighTrafficRoutes()` 在所有頁面 idle 後都會去抓 Login / Register / Pricing / Experts / Legal 五個 chunk**。在 production build 這沒差，但在 Vite dev / preview，每個 chunk 都是一次完整的 transform round-trip，跟「當前頁面自己要的模組」搶頻寬。Login.tsx 1.28s、Pricing.tsx 1.19s 就是這樣灌進來的。

2. **`/expert/:slug` 直接呼叫 supabase，沒有用既有的 `useExpert(slug)` React Query hook**。從 /app/explore 點進來時，experts 列表已經有完整資料（含 plans），但詳情頁丟掉它、重打 `experts` + `expert_plans` 兩支 query。

3. **詳情頁查詢仍有一段序列依賴**：先 `experts` → 拿到 `expert.id` 才打 `expert_plans` → 拿到 plan_ids 才打 `member_subscriptions count`。這條鏈在慢網路下會放大成 3 × RTT。

4. **`useExpertPerformanceRealtime` 在 PerformanceOverviewPanel 一掛上就開 websocket channel**，但這頁的 perf 資料 5 分鐘才更新一次，realtime 對首屏完全沒幫助、只增加握手成本。

5. **`/app/explore` 的 `useExperts` 與 `useSubscribedExpertSlugs` 各自獨立 query**，目前 OK，但 queryKey 帶 `user?.id ?? 'guest'` —— 登入態切換會整批 miss。這個先觀察、不一定要改。

## 改動計畫

### Step 1 — 限縮 prefetch（最大且最安全的勝點）
- 改 `src/lib/routePrefetch.ts`：`prefetchHighTrafficRoutes` 只在 `import.meta.env.PROD` 才執行；dev/preview 直接 no-op。
- 另外加一個 `prefetchOnHover(key, loader)` helper（用 mousedown / touchstart 觸發），給首頁的「登入」「定價」按鈕掛上去，把 idle 預載換成意圖預載。
- 預期效果：/expert/:slug 首次載入少 ~5 個 chunk，FCP 直接砍掉至少 1.5s（在 preview 環境）。

### Step 2 — `/expert/:slug` 改吃 React Query
- 把 `src/pages/ExpertProfile.tsx` 的 `useEffect + setState` 換成：
  - `useExpert(slug)` —— 直接複用 `useExperts()` 已 cache 的列表結果（key 都是 `['experts', userId, mode]`，可在 `useExpert` queryFn 裡先試讀列表 cache 命中就回，省一次 RTT）。
  - 新增 `useExpertSubscriptionStats(expertId)` hook，把「我訂的方案 IDs」+「總訂閱人數」合成一個 query（共用 staleTime 60s）。
- 移除頁面內的 `loading` / `expertInfo` / `dbPlans` 三段 useState；改由 query 的 `data` 直出。
- 從 /app/explore 點進詳情頁時：experts 列表已熱 → 詳情頁第一幀直接渲染基本資料 + plans，**不再看到 Loader2**。

### Step 3 — 合併剩下兩支 query 成一次 RPC
- 新增 supabase RPC `get_expert_detail_bundle(_slug text)`：一次回傳 expert 主資料、active expert_plans、我的訂閱 plan_ids、訂閱人數 count。
- `useExpert` 改吃這支 RPC（保留舊 client-side fallback 給管理後台）。
- 把 detail 頁的 3 段網路降為 1 段；最差情境的 detail FCP 從 ~3 RTT 縮為 1 RTT。

### Step 4 — 延後 realtime / 重 chunk
- `PerformanceOverviewPanel` 把 `useExpertPerformanceRealtime` 包進「進入 viewport 後才啟用」的條件（已經有 `LazyOnVisible` 包住面板，把 realtime hook 移到面板內部第一個 useEffect 之後即可，不會再阻塞 hero）。
- `recharts` import 改成在 PerformanceOverviewPanel 內部 dynamic import（目前 PerformanceOverviewPanel 自己是 lazy，但它一掛上就 sync import recharts；可以把圖表本身再切一層 lazy chunk，hero + KPI 先出來）。

### Step 5 — 驗證
- 重跑 `browser--performance_profile` 對比 FCP / Script Duration / fetch 數。
- 加一個 e2e case：從 /app/explore 點進 /expert/sharkgu，斷言詳情頁 mount 後 200ms 內 `useExpert` query 沒有重新 network fetch（命中列表 cache）。

## 不做的事
- 不改 RLS / 不動 trade_records 結構 —— Supabase 端目前不是瓶頸。
- 不全面改 Vite build config —— production bundle 已經正常，問題只在 dev/preview 與 idle prefetch 行為。
- 不重畫 UI、不動色彩 token。
