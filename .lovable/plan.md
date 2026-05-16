# 全站載入效能優化計畫

目標：把 P75 首屏 TTI 與 route 切換等待時間至少砍半，重點處理「初始 JS 太大、第一次進每頁都白屏、checkup 啟動同步抓 5 個雲端」三大病灶。

## 現況盤點（已實測）

1. **入口 JS 偏胖**
   - `tiptap` 全家（編輯器）只有 admin `RichTextEditor` 用到，但目前不在 manualChunks 分組，可能被打進共用 chunk
   - `recharts` 三處用（Revenue / chart.tsx / PerformanceOverviewPanel），未獨立分塊
   - `openai` 套件 4.x 在 `package.json` 但 `src/**` 完全沒 import → 純死碼依賴
   - `heic2any`、`embla-carousel-react`、`react-day-picker`、`@tiptap/*` 均無 manualChunks，會混進路由 chunk
2. **每個 route 都 `lazy()` 但沒有任何 prefetch**：使用者點 nav 才開始下載 chunk → 白屏 200~600ms
3. **`FreeCheckup.jsx` 4513 行單檔**：首次進 `/freecheckup` 必須整檔解析 + 4 個 store + bootstrap 5 個 cloud fetch
4. **`usePortfolioBootstrap` 啟動時序**：`Promise.all` 同時打 5 支 edge function（brain / events / holdings / history / research），任何一支慢就拖慢 ready
5. **`index.html`**：Google Fonts 兩組（Noto Sans TC 5 weights + Inter 5 weights + Ma Shan Zheng）= 11 個 woff2 並行下載；critical CSS 已 inline 但字型仍是阻塞瓶頸
6. **`installVersionCheck()` & `installEdgeFetchInterceptor()`** 在 main.tsx 同步執行
7. **React Query persister** 用 sync localStorage，首屏 hydrate 期間阻塞主執行緒（throttle 1500 但首次仍同步讀整包）
8. **沒有 route-level `<link rel="modulepreload">`**：Vite 自動生成 manifest 但 SPA 沒利用

## 優化計畫（按 ROI 排序）

### P0 — 立刻見效，動最少程式碼

1. **移除死碼依賴**
   - `bun remove openai`（src 零引用，僅 edge function 用，那邊獨立 deno）
   - 預估初始 bundle -80~150KB（gzip 後 -25KB）

2. **`vite.config.ts` manualChunks 補完**
   - 新增分組：`vendor-tiptap`（@tiptap/*, prosemirror）、`vendor-recharts`、`vendor-radix`（@radix-ui/*）、`vendor-tanstack`（已有）、`vendor-utils`（date-fns, zod, dompurify, clsx, tailwind-merge）
   - 效果：admin 才需要的 tiptap 不會混進 portal / app chunk

3. **字型瘦身**
   - Noto Sans TC 只保留 `400;500;700`（移除 300/600）
   - Inter 只保留 `400;500;700`
   - Ma Shan Zheng 改 `font-display: swap` + 改為「使用時才載入」（用 CSS `@font-face` + `unicode-range` 限定，或只在需要的元件動態插入 link）
   - 預估 woff2 下載 11 → 6 個

4. **route prefetch**
   - 新增 `src/lib/routePrefetch.ts`：在 nav `<a>` hover / `requestIdleCallback` 觸發 `import()` 對應 route chunk
   - 套到 `AppLayout` / `PortalLayout` / `AdminLayout` 的主導航
   - 進入 `/legal`、`/pricing` 等高曝光頁時，閒置時 prefetch `Login`、`Register`、`Experts`

### P1 — Bootstrap 與資料層改造

5. **`usePortfolioBootstrap` 拆「critical / deferred」**
   - 首批只 `setReady(true)` 後立刻渲染：本地 snapshot + holdings 雲端拉取
   - 第二批用 `requestIdleCallback`：brain / events / history / research（這些都不是首屏 above-the-fold）
   - 預估 ready 由 ~800ms → ~200ms

6. **React Query persister 改 async + 限制 key**
   - 改用 `createAsyncStoragePersister` + IndexedDB（或 `idb-keyval`）
   - hydrate 移到 `requestIdleCallback`，首屏優先渲染
   - 已有 `PERSISTED_QUERY_PREFIXES` 白名單，確認 filter 真的生效

7. **`installVersionCheck` / `installEdgeFetchInterceptor` 延後**
   - 兩者搬到 `requestIdleCallback(..., { timeout: 3000 })`
   - 釋放主執行緒給首屏

### P2 — FreeCheckup 單檔拆分

8. **拆 `FreeCheckup.jsx`（4513 行）**
   - 已知 inline 渲染不能拆元件（記憶體中規則），但可拆「資料/邏輯層」：
     - `useFreeCheckupBootstrap.js`（demo seed、密碼驗證）
     - `useFreeCheckupQuotes.js`（行情輪詢）
     - `useFreeCheckupAnalysis.js`（AI 分析狀態）
   - 主檔留 JSX 與 inline render；hooks 可被 tree-shake / 延後執行
   - 預估解析時間 -40%

9. **`HoldingsTab` 已完成 A-E 階段**，剩 F: 把 `holdingsTab.css` 加入 `vite.config.css.devSourcemap=false` + 確認進了非首屏 chunk

### P3 — 圖片與第三方

10. **`heic2any` 動態 import**
    - 改成 `await import('heic2any')` 只在使用者上傳 HEIC 時才載入
    - 預估省 ~200KB

11. **`embla-carousel-react` 用點審查**：若僅 1-2 處使用，改 dynamic import；無使用就移除

12. **Recharts 樹搖**
    - 改 named import：`import { LineChart, Line } from 'recharts'` 已是 named，但 recharts 內部仍會 pull D3 全家
    - `chart.tsx` 拆出 `LazyChart`，用 `<Suspense>` 包

### P4 — 監控與驗證

13. **新增 `scripts/check-bundle-size.mjs`**
    - build 後比對 dist/assets 各 chunk gzip 大小，超過 threshold 警告
    - 加入 `.github/workflows/test.yml`

14. **Lighthouse CI 抽樣**
    - 對 `/`、`/legal`、`/pricing`、`/freecheckup`、`/app` 跑 LHCI，記錄 LCP / TBT 基準

## 預估收益

| 項目 | 現況（估） | 改後（估） |
|------|---------|---------|
| Initial JS (gzip) | ~480KB | ~260KB |
| LCP（/legal） | ~2.4s | ~1.2s |
| Route 切換 TTFB | 200-600ms | <50ms（prefetch 命中） |
| FreeCheckup ready | ~800ms | ~200ms |

## 技術細節

```ts
// vite.config.ts manualChunks 補完
manualChunks(id) {
  if (!id.includes('node_modules')) return;
  if (id.includes('lucide-react')) return 'vendor-lucide';
  if (id.includes('@supabase')) return 'vendor-supabase';
  if (id.includes('react-dom') || id.includes('react-router') || id.includes('scheduler')) return 'vendor-react';
  if (id.includes('@tanstack')) return 'vendor-tanstack';
  if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-tiptap';
  if (id.includes('recharts') || id.includes('d3-')) return 'vendor-recharts';
  if (id.includes('@radix-ui')) return 'vendor-radix';
  if (id.includes('date-fns') || id.includes('zod') || id.includes('dompurify')) return 'vendor-utils';
}
```

```ts
// src/lib/routePrefetch.ts
const cache = new Set<string>();
export function prefetchRoute(loader: () => Promise<unknown>, key: string) {
  if (cache.has(key)) return;
  cache.add(key);
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loader().catch(() => cache.delete(key)));
  } else {
    setTimeout(() => loader().catch(() => cache.delete(key)), 200);
  }
}
```

## 實作順序

第 1 批（同 PR）：P0 全部 → 預期立刻砍 -30% bundle
第 2 批：P1 bootstrap / query 改造
第 3 批：P2 FreeCheckup hook 拆分
第 4 批：P3 動態 import
第 5 批：P4 監控

要先動哪一批？建議 **P0 一次合**，量化基準後再決定 P1 / P2 順序。
