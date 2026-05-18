# legendflow Logo 套用計畫

## 決策確認

| # | 決策 | 結果 |
|---|---|---|
| 1 | 站名 | **雙品牌**：站名文字仍為「智富股市實戰學院」（SEO/email/合約不動），logo 視覺改為 legendflow |
| 2 | CTA 主色 | **暫不換**，保留現有 `--primary` / `--cta`。`#EC662D` 僅出現在 logo 點與 brand assets。記憶保留待未來啟用 |
| 3 | 範圍 | **分階段執行**，每階段獨立可驗收 |

---

## Phase 1 — Logo 視覺替換（最小風險、可立即上線）

替換 header/footer 的 `TrendingUp` icon + 文字組合，文字保留「智富股市實戰學院」。

**檔案：**
- `src/components/layouts/PortalLayout.tsx` — header L57-61、footer L177-181
  - 移除 `<div className="bg-foreground"><TrendingUp /></div>`
  - 改為 `<Logomark size={36} />`（header）/ `<Logomark size={32} />`（footer）
  - 文字「智富股市實戰學院」**保留**
- `src/components/layouts/AppLayout.tsx` — header logo 區塊同樣替換為 `<Logomark size={32} />`
- `src/components/layouts/AdminLayout.tsx` — 若有 logo 區塊一併替換（需先讀檔確認）
- 移除 `TrendingUp` 的 import（若無其他用途）

**驗收：**
- 桌面 + 手機 header/footer logo 改為墨黑方塊 `l●f`
- 站名文字「智富股市實戰學院」未動
- 淺色 / 深色主題下 Logomark 對比正常

---

## Phase 2 — Favicon + OG 圖

**檔案搬移：**
- `brand/legendflow-favicon-16.svg` → `public/favicon-16.svg`
- `brand/legendflow-favicon-32.svg` → `public/favicon-32.svg`
- `brand/legendflow-favicon-180.svg` → `public/apple-touch-icon.svg`
- `brand/legendflow-favicon-512.svg` → `public/favicon-512.svg`
- `brand/legendflow-og-1200x630.svg` → `public/og-image.svg`
- 刪除舊 `public/favicon.ico`（避免瀏覽器預設請求覆蓋）

**`index.html` 修改：**
- 加入多尺寸 `<link rel="icon">` / `apple-touch-icon`
- 加入 `<meta property="og:image" content="https://legendflow.tw/og-image.svg" />`
- `<title>` / `og:title` / `og:site_name` / JSON-LD `name` **不動**（站名仍為「智富股市實戰學院」）

**驗收：**
- Tab favicon 顯示橘點墨黑方塊
- Social preview 顯示 legendflow OG 卡

---

## Phase 3 — Brand 字型載入

加入 Source Serif 4 + Noto Serif TC 給 Logomark/Wordmark 使用（不替換現有 Noto Sans TC / Inter 內文字型）。

**`index.html`：**
- 在現有 Google Fonts `<link>` 加入 `Source+Serif+4:wght@600;700` 與 `Noto+Serif+TC:wght@600;700`
- 保持非阻塞載入模式

**`tailwind.config.ts`（可選）：**
- 新增 `fontFamily.serifBrand` token，供未來 brand 區塊使用

**驗收：**
- Logomark `l●f` 顯示 Source Serif 4 字型（非 fallback Georgia）
- Network 確認 fonts 載入

---

## Phase 4（保留、不執行）— 主色切換到 #EC662D

依使用者決策**暫不執行**，但留下記憶與切換清單：
- `src/index.css` 中 `--primary` / `--cta` HSL 值改為 `17 80% 55%`
- 需全站 visual regression（所有 button、active state、advisor 識別色）
- 啟用時須另開 PR + 截圖審查

> 記憶已記錄於 `mem://brand/legendflow-identity`，未來指令「啟用 brand 主色」即執行此階段。

---

## 不在本計畫內

- 站名文字替換（雙品牌決策已排除）
- Email 模板、Line push、合約頁文案（站名不動）
- `sitemap.xml` / `robots.txt` / `llms.txt`（站名不動）
- SEO `<title>` 後綴（站名不動）
- 主色 token 變更（Phase 4 保留）

---

## 執行順序建議

1. **Phase 1 單獨上線** → 視覺驗收 OK 再進 Phase 2
2. **Phase 2 + Phase 3 可合併一個 PR**（都是 head 區與 public assets）
3. Phase 4 等使用者另行指示

按「實作計畫」後我會從 Phase 1 開始，做完回報再進下一階段。