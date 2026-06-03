## 目標

把「LINE 註冊禮：第一次免費、第二次付費」整條使用路徑做到端到端可驗證、後端容錯、稽核可追、時區一致。共 4 個子目標、6 個檔案新增、5 個檔案修改。

---

### 1. 統一時區 — Asia/Taipei 共用 helper（先做，其他都依賴）

新增 `src/checkup/utils/formatTaipeiDate.ts`：
- `formatTaipeiYMD(iso: string | null | undefined): string` — 回傳 `YYYY/MM/DD`，無效或 null → `''`
- `formatTaipeiYMDWithFallback(iso, fallback = '尚未使用'): string` — null/invalid 都回 fallback
- 內部用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', ... })`，取代現有 `+8*3600*1000` 的手算偏移（DST 安全 + 跨年正確）

修改：
- `HoldingsQuotaMeter.tsx` 拿掉內部 `formatYMD`，改 import
- `DailyTab.jsx` 同上
- `CheckupPlansSection.tsx`（若有顯示日期則同步）

新增測試 `src/test/unit/format-taipei-date.test.ts`：
- 12 case：跨日（UTC 16:00 → 隔日台北）、跨月、跨年、月初、月底、閏年、null、undefined、空字串、`not-a-date`、ISO 帶毫秒、ISO 不帶時區（視為 UTC）

### 2. 後端 last_used_at 容錯

新 migration：`check_checkup_quota` 在 `v_last_used_at` 查詢用 `COALESCE` 包裹、`limit=0` 時顯式 NULL、加上 `EXCEPTION WHEN OTHERS` 兜底（回 NULL 不丟錯）。

前端 fallback：
- `HoldingsQuotaMeter.tsx`：`line_free + remain=0 + last_used_at=null` → 顯示「LINE 註冊禮已用完・**使用日：尚未紀錄**・升級後可繼續使用」
- `DailyTab.jsx`：同樣 fallback 文案

更新 `checkup-quota-display.test.tsx` 補 1 個 case：`last_used_at=null` 時顯示「使用日：尚未紀錄」而非整段消失。

### 3. 配額稽核頁 / 查詢 API

新 edge function：`supabase/functions/checkup-quota-audit/index.ts`
- 只允許 `company_admin`（驗 JWT + `has_role`）
- Query：`?user_id=...&limit=100`
- 回傳：該用戶當前 `tier / period / limit / used / remaining / resets_at / last_used_at` + 最近 N 筆 `checkup_usage`（id, kind, used_at）
- 同時回傳該用戶 `checkup_subscriptions` 最近一筆（plan_id, status, expires_at, billing_cycle）作為「扣費原因」

新頁面：`src/pages/company/CheckupQuotaAudit.tsx`
- 輸入 user_id / email → 查詢
- 顯示 tier 卡片、最近扣次列表（含每筆使用日 YYYY/MM/DD HH:mm 台北時區）、訂閱來源
- 路由加到 `CompanyLayout` 子路由 `/company/checkup-quota-audit`

不新增資料表（`checkup_usage` 已有完整紀錄，sub 表已有來源）。

### 4. E2E 測試 — LINE 註冊禮一次免費 → 二次付費

新檔 `e2e/line-checkup-free-gift.spec.ts`，用 `e2e/helpers/supabase-mock.ts` 模擬：

**Scenario A（首次免費）**：
- mock `check_checkup_quota` → `{ tier: 'line_free', period: 'lifetime', limit: 1, used: 0, remaining: 1, resets_at: 'infinity', last_used_at: null }`
- 進入 `/portfolio/holdings` → 斷言 HoldingsQuotaMeter 文案含「LINE 註冊禮：第一次免費；第二次起需付費・還剩 1 次」、無「使用日」
- 進入 daily tab → 斷言「還可使用 1 次」

**Scenario B（已用完）**：
- mock → `{ ..., used: 1, remaining: 0, last_used_at: '2026-06-03T05:30:00Z' }`
- 斷言「LINE 註冊禮已用完・使用日 2026/06/03・升級後可繼續使用」
- 斷言 CTA「查看訂閱方案」連結 `/pricing#checkup`
- 斷言 DailyTab 顯示「（已用完・使用日 2026/06/03）」

**Scenario C（last_used_at null fallback）**：
- mock → `{ ..., used: 1, remaining: 0, last_used_at: null }`
- 斷言「使用日：尚未紀錄」出現

---

### 技術備註

- 所有日期顯示一律走新 helper，禁止散落 `new Date().toLocaleDateString` 或手算 `+8*3600*1000`
- E2E 用 route intercept mock RPC，不打真 DB；audit 頁也加 1 個 vitest 渲染測試
- 不動 `consume_checkup_quota` 行為（user 沒要求改扣點邏輯）

### 交付清單

新增：`src/checkup/utils/formatTaipeiDate.ts`、`src/test/unit/format-taipei-date.test.ts`、`supabase/functions/checkup-quota-audit/index.ts`、`src/pages/company/CheckupQuotaAudit.tsx`、`e2e/line-checkup-free-gift.spec.ts`、1 個 migration

修改：`HoldingsQuotaMeter.tsx`、`DailyTab.jsx`、`CheckupPlansSection.tsx`（如需）、`checkup-quota-display.test.tsx`、`CompanyLayout` 路由
