# AGENTS.md

legendflow — React 18 + Vite + TypeScript 前台，Lovable Cloud（Supabase）後端。

## Agent skills

### Issue tracker

Issues 以本地 markdown 檔管理，放在 `.scratch/<feature-slug>/`。See `docs/agents/issue-tracker.md`.

新功能 issue 必用範本 `docs/agents/issue-template.md`，強制包含**驗收標準**、**頁面／路由清單**、**資料來源**三區塊。


### Triage labels

沿用五個標準 triage 角色字串（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），記錄在每個 issue 檔的 `Status:` 行。See `docs/agents/triage-labels.md`.

### Module boundaries

持倉看板五個深模組的邊界由機制強制，不靠自律：`npm run check:module-boundaries`（ESLint + Vitest + CI 三重）。
規則與理由見 `docs/adr/0001-checkup-five-deep-modules.md`。

### Holdings price spectrum

Keep the drawer's single TWD price scale in the reusable PriceSpectrum presentation component; valuation calculation and fetching stay in their existing modules, so visual changes cannot alter financial inputs.


### Domain docs

Single-context：根目錄 `CONTEXT.md`（領域語彙，禁放實作細節）加 `docs/adr/`（不可逆且有取捨的決策）。See `docs/agents/domain.md`.

### Valuation fundamentals

Holdings-drawer PE/PB/PS denominators and multiples come only from the read-only `valuation-fundamentals` Edge Function (pure math in `supabase/functions/_shared/fundamentalsBasis.ts`, shared with Vitest). Share counts use official par (TWSE/TPEx list; if that list times out, FinMind issued shares ÷ capital snapped to a standard par, with preferred shares treated as unverified) and parent net income must reconcile by `origin_name`; why: keeps the FinMind token server-side, keeps `stock_fundamentals` admin-only, forbids price-derived (circular) denominators, and keeps a slow official list from blocking the drawer. Target financials are fetched 7 years (prices 5) so TTM YoY has its base years; low-confidence history multiples render only as per-ruler "歷史估值參考（低信心，非合理價）" bands, whose three-way intersection may be called 三尺重疊參考 but never a fair value. Personal multiples stay device-local and are labelled as the user's own scenario, never as teacher or fair-value output.
