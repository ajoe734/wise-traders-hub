## 目標
正式區 `/experts` FCP 6.3s → 目標 ≤ 2.5s。動 5 個地方。

---

### 1. `index.html` — 字型 async 載入 + preconnect Supabase

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://yqacmrgdjlenbijclngi.supabase.co" crossorigin>
<link rel="preload" as="style" href="...Noto+Sans+TC...Inter...">
<link rel="stylesheet" href="...Noto+Sans+TC...Inter..." media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="..."></noscript>
<link rel="stylesheet" href="...Ma+Shan+Zheng..." media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="...Ma+Shan+Zheng..."></noscript>
```

砍掉 `src/index.css` 第 1 行的 `@import url('...Noto Sans TC...Inter...')`（重複且 render-blocking）。

預計：FCP 砍 ~1.2s。

---

### 2. `src/App.tsx` — `Index` 改 lazy

```ts
const Index = lazy(() => import("./pages/Index"));
```

第 19 行的 eager import 移除。`<Suspense>` 已包覆 `<Routes>`，不需要額外 fallback。

---

### 3. `vite.config.ts` — 把 lucide-react 全併到單一 vendor chunk，避免 per-icon 拆檔

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (id.includes('node_modules/lucide-react')) return 'vendor-lucide';
        if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
        if (id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) return 'vendor-react';
      },
    },
  },
},
```

正式區現在每個 icon 一個 1KB chunk，每個 1.5～2s（CDN round-trip）。合併後一次 fetch。

---

### 4. avatar 走 Supabase Image Transform

5 個檔案要改：`src/components/ExpertCard.tsx`、`src/components/PersonCard.tsx`、`src/pages/ExpertProfile.tsx`、`src/pages/app/ExpertDetail.tsx`、`src/pages/app/Explore.tsx`。

新增 `src/lib/imageTransform.ts`：

```ts
export function avatarUrl(url?: string | null, size = 160): string {
  if (!url) return '/placeholder.svg';
  if (!url.includes('/storage/v1/object/public/')) return url;
  return url.replace('/object/public/', '/render/image/public/') + `?width=${size}&quality=75&resize=cover`;
}
```

每個用到 avatar 的地方包成 `avatarUrl(person.avatarUrl, 160)`（`<img loading="lazy" decoding="async">` 也順手加）。

---

### 5. lazy 路由的 `Suspense` fallback 不要全屏 60vh blank

目前 `RouteFallback` 是 `min-height: 60vh` 空白，視覺上看起來「卡住」。改成 PortalLayout 殼 + skeleton，至少 header / nav 立即顯示，感受速度。先用最簡 skeleton：

```tsx
const RouteFallback = () => (
  <div style={{ minHeight: "60vh", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
  </div>
);
```

---

## 驗證

- `bun run build` 通過、無 type error
- 重 deploy 後到 `https://legendflow.tw/experts` 重跑 `browser--performance_profile`，比對 FCP / DCL / 資源請求數
- 預期：FCP < 3s，icon chunks 從 8+ 降為 1 個 vendor chunk

不動測試（現有 unit/integration 不受影響）。
