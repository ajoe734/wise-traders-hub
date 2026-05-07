## 目標
把 `/experts` FCP 從 3.9s 再往下壓到 ≤ 3.0s，處理上一輪量測剩下的三個瓶頸。

---

### 1. `index.css` 21KB render-blocking（867ms）→ critical CSS inline + 主檔 async

**做法**：
- 在 `index.html` `<head>` 直接 inline 一段 ~2KB 的 critical CSS：只放 `:root` 色票變數、`html/body` 字型 + 背景、`#root { min-height: 100vh }`、spinner keyframes。讓首屏在主 CSS 還沒下載完前就有正確顏色與字型。
- 主 `index.css`（由 Vite 注入的 `<link rel="stylesheet">`）改為非阻塞載入。Vite 預設會 inject 阻塞式 link，需要在 `index.html` 用一段 inline script 把 build 後的 stylesheet `media` 先設成 `print`、`onload` 再切回 `all`。或改用 `vite-plugin-css-injected-by-js` 之類的 plugin 把 CSS 注入 JS（不採用，會放大 JS bundle）。

**選定方案**：手刻 inline script，找到 `<link rel="stylesheet" ... .css>` 把 media swap 一次。理由：零依賴、可控。

預計：FCP 砍 ~600ms。

---

### 2. `Experts-*.js` 路由 chunk 1,353ms → idle prefetch

**做法**：
在 `src/pages/Index.tsx`（首頁）掛一個 `useEffect` + `requestIdleCallback`，閒置時 `import('./Experts')` 觸發 chunk 預抓。同理對 `Pricing`、`Login` 等熱門路由各補一行。

```ts
useEffect(() => {
  const idle = (cb: () => void) =>
    'requestIdleCallback' in window
      ? (window as any).requestIdleCallback(cb, { timeout: 2000 })
      : setTimeout(cb, 1500);
  idle(() => {
    import('./Experts');
    import('./Pricing');
  });
}, []);
```

預計：使用者從首頁點 `/experts` 時 chunk 已在 cache，路由切換 FCP 接近 0。

---

### 3. `~api/analytics` XHR 1,330ms → defer 到 idle 後

**做法**：
- 全文搜尋 analytics 觸發點（`useAttributionTracking.ts` 已知是其一），把 `track / pageview` 的呼叫包到 `requestIdleCallback`（fallback `setTimeout(_, 0)` after `load`）。
- 不影響資料完整性：就算使用者 1.3s 內離開，beacon 模式（`navigator.sendBeacon`）也能補送。如果現在用 `fetch`，順便改用 `keepalive: true`。

預計：解放主執行緒 ~1.3s 的網路 + JS。

---

## 驗證

- `bun run build` 通過
- 部署後再跑 `browser--performance_profile` `https://legendflow.tw/experts` 對比 FCP / LCP / Full Load
- 預期：FCP 3.9s → ≤ 3.0s，路由切換感受幾乎即時

---

## 不動

- 不動 TTFB（Lovable CDN 平台層，前端解不了）
- 不動字型、lucide chunk（已在上一輪處理）
- 不動 avatar transform（已在上一輪處理）
