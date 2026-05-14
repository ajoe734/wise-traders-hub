## 全站頭像／縮圖審計結果

### 真正會「被拉變形」的根因
1. **Flex row 中的 `<img>` 沒有 `shrink-0`**：當旁邊的名字／文字過長時，圖片會被 flex 容器壓扁、寬高失衡（瀏覽器先按 `width` 縮，但 `height` 不會等比縮 → 拉長）。
2. **直接用 `<img>` 載原圖**：沒走 `avatarUrl()` CDN 縮圖，原圖 1–3 MB 拉到 32px 渲染既慢又容易在 layout shift 時看到拉伸。
3. **`object-position` 不一致**：只有 `ExpertCard` / 剛修的 `Explore` 用 `object-[center_15%]`，其他卡片臉部偏低或被裁掉。
4. **Avatar 預設 size 與請求 size 不匹配**：`AppHome`、`AppCheckout`、`ExpertDetail` 都用 `<AvatarImage>` 直接吃 `avatar_url` 原圖。

### 全站使用點清單（會處理的檔案）

頭像（人臉，需正方形 + `object-[center_15%]` + CDN 縮圖）：
```
src/components/JournalCard.tsx           h-8  w-8   flex 內，無 shrink-0、未走 avatarUrl
src/components/SignalCard.tsx            h-6  w-6   flex 內，無 shrink-0、未走 avatarUrl
src/components/PersonCard.tsx            h-14 w-14  flex 內，無 shrink-0
src/components/LineBindingCard.tsx       h-8/h-10   一處缺 shrink-0、未走 avatarUrl
src/components/layouts/AdminLayout.tsx   h-10 w-10  flex 內，無 shrink-0、未走 avatarUrl
src/pages/PlanDetail.tsx                 h-16 w-16  flex 內，無 shrink-0、未走 avatarUrl
src/pages/ExpertProfile.tsx              h-32/40    rounded-2xl，OK 但沒走 avatarUrl 給對應 size
src/pages/Checkout.tsx                   h-14 + h-10  缺 shrink-0、未走 avatarUrl
src/pages/app/AppHome.tsx (×3)           Avatar 預設 40，未走 avatarUrl
src/pages/app/AppCheckout.tsx            Avatar h-12，未走 avatarUrl
src/pages/app/ExpertDetail.tsx           AvatarImage 直吃原圖
src/pages/app/Account.tsx                h-12 w-12 flex 內，無 shrink-0、未走 avatarUrl
src/pages/app/Signals.tsx                h-6  w-6   flex 內，無 shrink-0、未走 avatarUrl
src/pages/app/SignalsDashboard.tsx       h-5  w-5   缺 shrink-0
src/pages/app/JournalDetail.tsx          h-10 w-10  flex 內，無 shrink-0、未走 avatarUrl
src/pages/admin/Signals.tsx              h-10 w-10  flex 內，無 shrink-0、未走 avatarUrl
src/pages/admin/Analysts.tsx             h-8  w-8   flex 內，無 shrink-0、未走 avatarUrl
src/pages/admin/Profile.tsx              h-20 w-20  未走 avatarUrl
src/pages/company/Users.tsx              h-7  w-7   flex 內，無 shrink-0、未走 avatarUrl
src/components/WeeklyLimitUpLeaderboard  AvatarImage 直吃原圖
```

### 修正規則（一致套用）

對所有「人臉頭像」`<img>`：
```tsx
<img
  src={avatarUrl(url, size*2)}     // CDN 縮圖，request 2× 給 retina
  alt={name}
  loading="lazy"
  decoding="async"
  className="shrink-0 h-N w-N rounded-full object-cover object-[center_15%]"
/>
```

對所有 `<AvatarImage>`（已含 `aspect-square`、`object-cover`，Avatar 根已 `shrink-0`）：
- `src` 一律改走 `avatarUrl(url, size*2)`
- 額外加 `className="object-[center_15%]"`

非人臉縮圖（`Checkout` 商品圖 `h-14 w-14 rounded-xl`）：
- 補 `shrink-0`，但**不**加 `object-[center_15%]`（保持 center）。
- 走 `avatarUrl(url, 112)`（同 helper 對非 Supabase URL 透傳，可安全使用）。

### 驗證
1. `bun run build` 過。
2. 視覺檢查：`/app/explore`、`/app/home`、`/app/account`、`/app/signals`、`/app/expert/:slug`、`/expert/:slug`、`/checkout`、`/admin/*` 共 8 條路徑，於 viewport 360 / 414 / 739 三個寬度看頭像是否仍是正方形、臉部對齊、不再被名稱擠扁。
3. Network 面板抽查任一頭像，確認 URL 含 `/render/image/public/` 且 `width=` 為 2× 渲染尺寸。

### 不在此次範圍
- `Index.tsx` / `Pricing.tsx` 的 `bg-cover` hero 卡片（非頭像，目前無變形回報）。
- 設計系統重構（`Avatar` 預設值、抽 `<UserAvatar>` 元件）— 若你之後要再來統一可另開。
