
## 為什麼仍然慢（實際量測點）

`/experts`：
- `useExperts` 直接 `SELECT *, expert_plans(*)`，巢狀帶全欄位、走 PostgREST，每次都解 RLS。
- 而且 `enabled: !isAuthLoading` — 必須等 `supabase.auth.getSession()` 完成才會發出，常見 200–600ms 純等。
- 沒對 Supabase 做 `preconnect`，首訪要付一次 TLS。

`/pricing`：
- `Pricing.tsx` 內 `useEffect` 直接打 `expert_plans` 抓全部列只為了算最小值 → 沒 react-query 快取、每次進頁都重打，且回傳整張表。
- 同頁 `<CheckupPlansSection>` 又再開：① `useCheckupPlans` ② `supabase.auth.getSession()` ③ `rpc('check_checkup_quota')`，序列等待。
- 結果一個 `/pricing` 至少 3–4 個獨立 round-trip。

## 修改計畫

### 1. 後端：新增兩個輕量 RPC（一次 round-trip）

`supabase/migrations/*_pricing_perf.sql`

- `get_public_experts_list()` — STABLE SECURITY DEFINER，只回傳清單卡需要的欄位（id, slug, name, role, avatar_url, bio, style_tags, markets, strategy_*、backtest_* 與每位專家的 active plans 精簡欄位）；server-side 直接過濾 `status='active'`。取代 `SELECT *, expert_plans(*)`，payload 砍 ~60%、且省一次 RLS 多表評估。
- `get_pricing_bundle(_user_id uuid)` — 一次回傳：
  - `min_advisor_price` / `min_mentor_price`（取代 `Pricing.tsx` 的整表抓取）
  - `checkup_plans`（active, 按 sort_order）
  - `checkup_quota`（若 `_user_id` 非 null，內部呼叫 `check_checkup_quota`）

兩支都加上 `GRANT EXECUTE TO anon, authenticated`。

加索引（如尚未存在）：
- `experts(status, created_at)`
- `expert_plans(expert_id, is_active)`

### 2. 前端：`useExperts` 不再等 auth、改打 RPC

`src/hooks/useExpert.ts`
- 把 `enabled: !isAuthLoading` 拿掉 — 公開頁清單對所有人一樣，先發出 guest 查詢；auth 解析完成且為 tester 再額外刷新。
- queryFn 改呼叫 `rpc('get_public_experts_list')`；保留 tester 走原 `select *` 路徑以維持 draft 預覽。
- 維持既有 `staleTime: 5min` 與 `placeholderData: keepPreviousData`。

### 3. 前端：`/pricing` 改用單一 bundle hook

新增 `src/hooks/usePricingBundle.ts`：
- `useQuery(['pricing-bundle', userId])` → `rpc('get_pricing_bundle', { _user_id })`，`staleTime: 60s`。
- 回傳 `{ minAdvisorPrice, minMentorPrice, checkupPlans, checkupQuota }`。

改寫 `src/pages/Pricing.tsx`：
- 刪除 `useEffect` 直接打 `expert_plans` 的區塊，改用 `usePricingBundle()` 的 `minAdvisorPrice/minMentorPrice`。
- `CheckupPlansSection` 改接收 props（plans + quota），不再自行 `useCheckupPlans` / `auth.getSession()` / `rpc`。

如此 `/pricing` 從 3–4 round-trip 降為 **1**。

### 4. 加 preconnect，省冷啟 TLS

`index.html` `<head>` 加：
```html
<link rel="preconnect" href="https://yqacmrgdjlenbijclngi.supabase.co" crossorigin>
<link rel="dns-prefetch" href="https://yqacmrgdjlenbijclngi.supabase.co">
```

### 5. Nav hover 預取

在 `PortalLayout` 的 `/experts`、`/pricing` 連結加 `onMouseEnter` → `queryClient.prefetchQuery`，桌機常見可省 100–300ms。

## 驗證

- DevTools Network：`/experts` 首次應只 1 個 RPC、無 auth 阻塞；`/pricing` 只 1 個 RPC。
- `supabase--analytics_query` 看 RPC p95 < 150ms。
- 既有 `e2e/batch5b-react-query.spec.ts` 應仍通過；補一個 unit test 確認 `usePricingBundle` 在無 session 時也能拿到資料。

## 不動的

- 不改設計、不改路由、不改 RLS 模型（只是用 SECURITY DEFINER RPC 包成單次查詢）。
- 不動 `useExpertDetailBundle`（已是 bundle 模式）。
