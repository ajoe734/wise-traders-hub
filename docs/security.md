# Security Reference

權威來源。更新 RLS / helper / 部署流程時，**先更新本文件**，再寫 migration。

---

## 1. Helper / RPC callability matrix

> Supabase linter 0028/0029 會對所有 SECURITY DEFINER 函數丟 warning，這是 by-design 限制器警告，**不是漏洞**。每個函數內部都以 `has_role(auth.uid(), ...)` 或 `auth.uid()` 自我守門。

| Function | anon | authenticated | service_role | 必要性 |
|---|---|---|---|---|
| `has_role` | ❌ denied | ✅ allowed | ✅ allowed | **RLS 必要**：authenticated 查 auth-scoped 表時觸發；anon 從不查這些表故不需要 |
| `has_active_subscription` | ❌ denied | ✅ allowed | ✅ allowed | 同上 |
| `has_active_subscription_after` | ❌ denied | ✅ allowed | ✅ allowed | 同上 |
| `is_subscribed_to_plan` | ❌ denied | ✅ allowed | ✅ allowed | 同上 |
| `is_tester` | ❌ denied | ✅ allowed | ✅ allowed | 同上 |
| `is_company_admin` / `has_any_role` | ❌ denied | ✅ allowed | ✅ allowed | 同上 |
| `calculate_expert_performance(uuid)` | ✅ allowed | ✅ allowed | ✅ allowed | **公開內容**：前端 `usePerformance.ts` / `useExpertHoldingsBundle.ts` 公開老師卡片直接呼叫 |
| `get_pricing_bundle`, `get_public_experts_list`, `get_expert_detail_bundle` | ✅ allowed | ✅ allowed | ✅ allowed | 公開首頁 / 定價 |
| 所有 `admin_*`, `get_traffic_*`, `get_funnel_*`, `get_perf_metrics_summary`, `get_page_analytics`, `get_event_heatmap`, `get_top_instruments`, `get_traffic_health`, `get_user_journey`, `get_analyst_subscriber_profiles`, `get_expert_capital_status`, `get_weekly_limit_up_leaderboard`, `check_checkup_quota`, `check_knowledge_title_similarity` | ❌ denied | ❌ denied (內部 has_role gate) | ✅ allowed | 後台 RPC，內部以 `has_role(auth.uid(),'company_admin')` 在 function body 守門 |
| 所有 cleanup_* / consume_checkup_quota / derive_traffic_channel / archive_and_promote_knowledge | ❌ denied | ❌ denied | ✅ allowed | service-role only，edge function 專用 |

### Revoke 會破壞什麼

- **Revoke `has_role` from authenticated** → 整個 admin RLS 鏈崩潰，後台、quota、付款、流量分析全部 403。
- **Revoke `has_active_subscription*` / `is_subscribed_to_plan` from authenticated** → 訂閱內容（老師訊號、收盤分析）讀不到。
- **Revoke `is_tester` from authenticated** → 測試帳號配額計算錯誤。
- **Revoke `calculate_expert_performance` from anon** → 公開老師卡片白屏。
- **GRANT 任何 admin_* RPC to authenticated** → 一般使用者可看全站營收／流量／配額（資料外洩）。

---

## 2. 已收斂並上鎖的權限

下表是已實際 migration 修復、**未來絕不可回退**的設計。1.35 RLS audit 測試守住每一條。

| 表 / 物件 | 風險 | 收斂手段 | 測試 |
|---|---|---|---|
| `line_login_nonces` | anon 可能讀到 LINE access/refresh token | deny-all to anon/authenticated；只 service_role 可讀寫 | 1.35-A |
| storage `avatars` / `signal-media` | bucket 列舉外洩檔名 | 移除 SELECT policy；保留 public CDN URL 直讀單檔 | 1.35-B |
| `payment_providers` | config jsonb 含金流密鑰被 anon 讀到 | 移除「Anyone can view active providers」policy；對外只暴露 `payment_providers_safe` view（不含 config） | 1.35-G |
| `checkup_analysis_jobs` realtime | 廣播 holdings_snapshot / result_summary / raw_responses 給其他使用者 | publication 欄位收斂為 `id, user_id, status, error_text, finished_at` | 1.35-H |
| `checkup_prediction_accuracy` | 任何登入者可污染全站 90 天命中率統計 | 新增 user_id 欄位 + `WITH CHECK (user_id = auth.uid())`；前端 `useEventReviewWorkflow.js` 寫入時帶 `auth.uid()` | 1.35-E (隱含) |
| `paywall_events` | 登入者可冒名寫他人 user_id | INSERT WITH CHECK 從 `true` 改為 `user_id IS NULL OR user_id = auth.uid()` | 1.35-C |
| `traffic_events` | 若開放 anon INSERT 會被注入假流量 | 全部走 `traffic-ingest` edge function（service_role）。anon 直接 INSERT 永遠不可開啟 | 1.35-G note |

---

## 3. 自動化檢查（必須 CI 跑）

| Script | 用途 | CI |
|---|---|---|
| `npm run check:rls-audit` | 1.35 RLS / RPC 權限稽核（41 cases），驗證 helper matrix、payment_providers、checkup_analysis_jobs、payment scope | `.github/workflows/test.yml`（vitest）＋ `.github/workflows/security-audit.yml` |
| `npm run check:prod-debug` | grep dist/assets/*.js，禁止 `[checkup-bootstrap]` / `[checkup-holdings]` / `console.log("[checkup-…")` 流入 production | `.github/workflows/security-audit.yml` |
| `npm run check:security:all` | 上面兩個一次跑 | local pre-publish check |

任一失敗 → 阻擋部署。

---

## 4. Pre-publish smoke test checklist（人工驗收）

> 跟 `npm run check:security:all` 都過後再執行。

### A. /holding-checkup 行為
- [ ] 未登入訪客：每個 tab 都有 demo 資料（持倉 20 檔 + P&L、行事曆、事件分析、收盤分析 daily report、深度研究、6 筆交易日誌、上傳成交有說明卡）
- [ ] 已登入空倉使用者：不顯示任何 demo data，正確空狀態
- [ ] 切換 tab 不會把 demo data 寫入 localStorage / cloud
- [ ] 持倉看板入口、收盤分析入口、pricing 入口使用日文案正常

### B. Console / network
- [ ] DevTools console 完全沒有 `[checkup-bootstrap]` / `[checkup-holdings]` 輸出
- [ ] 沒有 4xx/5xx 紅色錯誤（除預期的 401 / 403 paywall）

### C. 安全面板
- [ ] Lovable Security panel：0 findings
- [ ] `npm run check:rls-audit` → 41/41 綠
- [ ] `npm run check:prod-debug` → 綠

### D. 角色與權限
- [ ] company_admin 登入：能進 /company 全部頁面（traffic、analytics、quota audit、plans）
- [ ] 一般 authenticated 使用者：訪問 /company/* 被擋
- [ ] anon：訪問 /company/* / /admin/* 導向登入

### E. 後台功能
- [ ] quota audit：單筆查詢正常、批次查詢正常、分頁上下頁正常、CSV 下載正常
- [ ] /company/traffic：頁面載入正常、空資料不壞、圖表 tooltip 可讀、手機版不擠爆、淺色 / 深色都可讀

### F. 付款 / LINE
- [ ] LINE 註冊新帳號首次收盤分析：免費（line_free quota=1）
- [ ] LINE 帳號第二次收盤分析：被 paywall 擋住
- [ ] checkout 入口、續訂 banner 正常

### G. SEO / brand
- [ ] index.html title / meta / og-image 正常
- [ ] favicon / wordmark 顯示正確
- [ ] /sitemap.xml 200

---

## 5. Maintenance rules

- 改 RLS / GRANT / policy 前先讀本文件，並更新 §1 §2 表格
- 新增 SECURITY DEFINER function → 加入 §1 matrix
- 新增 public-schema table → migration 內必須含 GRANT，並更新 §2
- 1.35 RLS audit 任一 case fail → 不准 ignore，必須修
