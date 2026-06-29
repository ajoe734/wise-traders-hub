## 目標
每位老師的個人頁都能「乾淨、IG 友善、預覽帶 legendflow logo + 老師資訊」地被分享出去。

## 目前缺口
1. **分享 URL 太醜、IG 容易擋**：現在 `ShareButton` 產生的是 `https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/share-og/expert/{slug}` — IG/Line 對 `*.supabase.co` 這種網域常標記為可疑、限制觸及。
2. **公開的 `/expert/:slug` 頁面（PortalLayout）沒有分享按鈕**，只有訂閱者後台 `/app/expert/:slug` 有。
3. **預覽卡 og:image 是 `expert.avatar_url`**（一張頭像，沒有 legendflow logo、沒有老師名字、不是 1200×630），社群預覽看不到品牌。沒頭像時退回 SVG，FB/IG/Line 對 SVG og:image 支援差。
4. 公開頁的 `SEO` 元件雖有引入，但未把 expert 專屬 title/desc/og:image 餵進去（待驗證後補上）。

## 改善計劃

### 1. 乾淨可分享的網址（IG 友善）
- 分享一律改用 **`https://legendflow.tw/expert/{slug}`** 這條 canonical URL，而非 supabase function URL。
- 修改 `src/lib/shareUrl.ts`：`kind: "expert"` 改回站台網域；其他 kind（signal/journal/plan）維持經 share-og（因為那些路徑是 ProtectedRoute）。
- 同時新增極短捷徑 `https://legendflow.tw/s/{slug}` → 內部 `<Navigate to="/expert/:slug" replace>`，方便寫在 IG bio（短、好記、不暴露結構）。

### 2. 動態 OG 卡片（預覽顯示 legendflow logo + 老師資訊）
新增 edge function `og-card`：
- 路徑：`/og-card/expert/{slug}` → 回傳 1200×630 PNG。
- 用 Deno + `@vercel/og` (Satori) 渲染：左側 legendflow wordmark（橘點）+ 老師頭像圓框、右側「{name}｜實戰導師／投顧分析師」+ 一句策略描述 + 底部 legendflow.tw。
- 純 JPG/PNG，FB/IG/Line/Slack 都吃。
- 公開無 JWT、`Cache-Control: public, max-age=86400`。
- 找不到老師時回預設 legendflow 品牌卡（不要 404）。

### 3. 把動態卡接上 og:image
- `share-og` function 的 `resolveExpert` / `resolvePlan` / `resolveSignal` / `resolveJournal`：`image` 改用 `${SITE}/functions/v1/og-card/expert/{slug}`（plan/signal/journal 也對應 og-card 端點，本期先做 expert，其餘沿用既有頭像）。
- 公開 `ExpertProfile.tsx`：在 `<SEO>` 補上 `title`/`description`/`type="profile"`/`image={ogCardUrl}`/`jsonLd: Person`。JS-aware crawler（Google/Twitter/部分 Slack）直接看到專屬卡；不執行 JS 的 crawler（FB/IG/Line）看 index.html 預設卡仍是 legendflow logo，不會破。

### 4. 公開頁加分享 UI
- `src/pages/ExpertProfile.tsx` 頂部資訊區加入既有的 `<ShareButton target={{kind:"expert", slug}}>`。
- 升級 `ShareButton`：除了「複製連結」，新增下拉：
  - 複製連結（clean `legendflow.tw/expert/{slug}`）
  - 系統分享（`navigator.share`，手機可直送 IG/Line/FB）
  - 下載 QR Code（PNG，方便放限動或實體卡片）
  - 「分享到 IG 限動」提示：複製連結 + 顯示一句操作說明（IG API 不允許直接寫入，但限動可貼連結貼紙）。

### 5. 驗證
- Playwright `e2e/expert-share.spec.ts`：訪客打開 `/expert/{slug}` → 點分享 → 確認複製值為 `https://legendflow.tw/expert/{slug}`；快捷 `/s/{slug}` → 跳轉到 `/expert/{slug}`。
- `curl` `og-card/expert/{slug}` → 200 + `image/png` + 1200×630。
- `curl` `share-og/expert/{slug}` → og:image 指向 og-card URL。
- 用 FB Sharing Debugger / LINE 預覽 / Twitter card validator 各跑一次 `legendflow.tw/expert/{slug}` 與 `share-og` 版本。

## 涉及檔案
- 修改：`src/lib/shareUrl.ts`、`src/components/ShareButton.tsx`、`src/pages/ExpertProfile.tsx`、`src/App.tsx`（加 `/s/:slug` route）、`supabase/functions/share-og/index.ts`。
- 新增：`supabase/functions/og-card/index.ts`、`supabase/config.toml` 加 `[functions.og-card] verify_jwt = false`、`e2e/expert-share.spec.ts`。
- 不動：`/app/expert/:slug` 既有 ShareButton（仍可用、會自動受益於新 shareUrl）。

## 後續可選
- 老師後台「我的分享素材」頁：直接下載 og-card PNG、QR、IG 限動 9:16 版本。
- 把 signal/journal 也接 og-card（本期先做 expert 確定可行）。
