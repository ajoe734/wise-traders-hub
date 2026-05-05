# 修後台對比 + 加手機版抽屜

確實之前那版顏色搞砸了：用 `text-muted-foreground` 在 `#F5F3EF` 上太淡，active 用 `bg-card` 跟背景幾乎同色看不出選中。同時 sidebar 是 `sticky w-64`，手機完全爆版。

## 改動

### 1. `src/components/layouts/CompanyLayout.tsx`（重寫）
- **抽出 `SidebarBody` 元件**，桌面與手機共用。
- **桌面（md+）**：保留原 `w-64` 固定側欄。
- **手機（<md）**：
  - 隱藏側欄
  - 加 sticky top bar（h-12）：左邊 `Menu` icon 觸發 Shadcn `Sheet` 從左滑出，內含 `SidebarBody`；右邊顯示「海洋福星後台」品牌
  - 點 nav item 後 `setOpen(false)` 自動收起抽屜
- **對比修正**：
  - nav 文字由 `text-muted-foreground` → `text-foreground/70`，hover → `text-foreground`
  - active 樣式由「`bg-card` 同色」→ `bg-foreground text-background`（黑底白字 pill），辨識度直接拉滿
  - 品牌文字、Email、icon 都用 `text-foreground/55~70`，不再依賴 muted-foreground
  - 暗色模式用 `hsl(var(--background))`，淺色保留 `#F5F3EF`
- 主內容包一層 `min-w-0` + `p-4 md:p-8`，避免子表格撐爆。

### 2. `src/index.css` `.company-shell` 微調
原本 `.company-shell .bg-card { background: #FFFFFF }` 在淺色 OK，但配上幾乎透明的 border (`hsl(0 0% 90% / 0.7)`) 卡片邊界看不見。改：
- border 透明度 `0.7 → 1`，並用 `hsl(0 0% 88%)` 略加深
- 加 `.company-shell, .company-shell * { color-scheme: light; }` 之類過度規則 → 不需要，改為直接補：`.company-shell .text-muted-foreground { color: hsl(0 0% 38%); }` 統一覆寫所有後台頁面的 muted 文字（一次解決 Analysts、Subscribers、KnowledgeBase…全部頁面 muted-foreground 太淡的問題）
- `.company-shell h1 { color: hsl(var(--foreground)); }` 顯式指定，避免被 oklch fallback 沖淡

### 3. 不動的部分
- 不重做各個 `/company/*` 頁面內部 layout（Tables 本身已 `overflow-auto`，桌面 sidebar 縮掉就有空間了）
- 不引入 shadcn sidebar component（成本高，現有結構夠用）
- 不改 `AdminLayout`（那是 expert 後台，不在本次範圍）

## 檔案
- 編輯：`src/components/layouts/CompanyLayout.tsx`
- 編輯：`src/index.css`（`.company-shell` 區塊）
