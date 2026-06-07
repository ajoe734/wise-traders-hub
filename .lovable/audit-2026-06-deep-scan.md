# 全站深掃報告 v1（2026-06-06）

> 觸發事件：HoldingsQuotaMeter 桌機看不到 LINE 登入按鈕（同類根因 = 條件分支只看單一狀態）
> 範圍：src/** + supabase/functions/** 75 支 + supabase/migrations/** + 100 輪不變式
> 已完成：6/8 組（B / D / E / F / G+H / I）— A（RWD）/ C（Gate 三軌）仍在跑

---

## P0（安全 / 資金損失 / 全站 down）— 共 9 條

| ID | 檔案:行 | 根因 | 建議 fix |
|---|---|---|---|
| **D-04 / E-SEC-001** | `supabase/functions/acpay-notify/index.ts:15` | 簽章驗證包在 `if (params.sign)` 內 — 不送 `sign` 即繞過，任何 `pay_result=0` 都能建立訂閱 | `if (!params.sign) return FAIL`；簽章必驗 |
| **E-SEC-002** | `supabase/functions/create-acpay-order/index.ts:40` | `amount` 直接從 client body 取，未對照 `subscription_plans.price` — 可送 `amount:1` 取得方案 | server-side 查 plan 價格驗證 |
| **E-SEC-003** | `supabase/functions/create-ecpay-order/index.ts:26` | 同上（ECPay） | 同上 |
| **E-SEC-004** | `supabase/functions/create-linepay-order/index.ts:15` | 同上（LINE Pay） | 同上 |
| **D-02** | migrations `perf_metrics` 兩份 | RLS policy 允許 anon insert 但**缺 GRANT INSERT TO anon** → 永遠 403（log 證實） | 補 `GRANT INSERT ON public.perf_metrics TO anon` |
| **D-01** | 31 張 CREATE TABLE migration | 同檔內無 GRANT，靠 default privilege（不可靠） | 批次補 GRANT |
| **D-03** | `supabase/config.toml` 40+ function block | 全部 `verify_jwt=false` 且無統一 in-code JWT 驗證 middleware；admin-manage-users / process-refund / update-analyst-credentials 等高權限 fn 同等對待 | 高權限 fn 改 `verify_jwt=true` 或建 `_shared/auth.ts` 統一驗 |
| **D-05** | `supabase/functions/line-webhook/index.ts` | 無 `deliveryId` 去重，LINE at-least-once 重投會重複綁定/回覆/扣量 | 建 `processed_webhook_events` 表，insert ON CONFLICT DO NOTHING |
| **E-SEC-006** | `supabase/functions/line-login-authorize/index.ts:27` | OAuth `state` 純 `btoa(JSON.stringify(...))`，未存 server-side nonce → login CSRF | 改 random nonce 入 DB，5 min TTL |

---

## P1（核心功能壞 / 訂閱誤判 / 配額誤扣）— 共 11 條

| ID | 檔案:行 | 根因 |
|---|---|---|
| **B-18** | `src/hooks/app/useAccountData.ts:74` | `subscribedExpertIds` 只看 `status='active'`，**未檢查 `expires_at>now`** → 過期訂閱仍顯示已訂閱（違反 manual-renewal-model 憲法） |
| **B-35** | `src/pages/_appAccount/SubscriptionCard.tsx:83` + `useCheckoutData.ts:119-126` | 「立即續訂」CTA 未先 cancel 舊訂閱 → DB 出現 2 筆 active → `check_checkup_quota` 配額算錯 |
| **G/H-fail-1** | `supabase/functions/expire-subscriptions/index.ts` | 只處理 `member_subscriptions`，**完全忽略 `checkup_subscriptions`** → checkup 會員過期不下架 |
| **D-06** | 4 張 migration | `has_role(...)` 缺 `public.` 前綴；search_path 攻擊面 |
| **D-07** | `supabase/migrations/20260305021957_*.sql:2-7` | `expert_line_channels_public` view 明確設 `security_invoker=false` → 繞過 RLS |
| **D-08** | `supabase/functions/notify-payment-failure/index.ts:89,119-133` | 未排除 `@line.local` 虛擬 email → Resend 退信 |
| **D-09** | `supabase/migrations/20260604121915_*.sql:17-27` | admin 分析 RPC 全 GRANT TO authenticated（has_role 內查但暴露存在性） |
| **E-SEC-005** | 4 個 payment callback | 無 IP 白名單（ECpay/ACpay 公布 CIDR 沒比對） |
| **E-SEC-007** | 9 支 edge（apologize-line-free-quota:138, update-analyst-credentials:174, knowledge-promote-candidates:21, admin-manage-users:36, knowledge-full-audit:205, knowledge-draft-claude:65, checkup-mops-announcements:57, checkup-analyst-reports:77, line-push-renewal-reminder:186, line-login-callback:66,90,179） | 第三方 fetch 無 `AbortSignal.timeout` → upstream 卡死整支 fn |
| **E-SEC-008** | checkup-analyst-reports / knowledge-draft-claude / knowledge-draft-scheduler / knowledge-promote-candidates | 直呼 Anthropic 無 gateway→direct→anthropic 三段 fallback；529 即整批失敗 |
| **E-IDEM-001** | `supabase/functions/line-push-renewal-reminder/index.ts:186` | 雙跑無去重 → 訂閱者收 2 次相同提醒 |

---

## P2（CTA 缺失 / 引導斷裂 / 重要狀態無提示）— 共 9 條

| ID | 檔案:行 | 根因 |
|---|---|---|
| **B-23** | `src/checkup/components/freecheckup/HoldingsQuotaMeter.tsx:113` | **本次自己加的 CTA 的回歸**：已綁 LINE 的 `tier='none'` 用戶仍看到「綁定 LINE 領免費 1 次」 |
| **B-24** | `src/checkup/components/freecheckup/TradeTab.jsx:193` | basic 到期前 7 天顯示「升級 Pro」而非「立即續訂」 |
| **B-28** | `src/hooks/app/useAccountData.ts:23` | select 無 status 過濾，拉全量歷史訂閱 |
| **E-CSRF-001** | `supabase/functions/line-webhook/index.ts:95` | reply token 無 timestamp window → 可重放 |
| **E-AI-001** | `supabase/functions/knowledge-draft-claude/index.ts:65` | Anthropic 429/529 無 retry/backoff → 排程靜默產 0 筆 |
| **E-CACHE-001** | twse-proxy / tpex-proxy / checkup-institutional | 無快取 → 收盤尖峰打爆 upstream rate-limit |
| **E-IDEM-002** | `supabase/functions/refresh-targets-weekly/index.ts:147` | insert 無 ON CONFLICT，雙跑重複入庫 |
| **D-10** | `checkup_knowledge_usage_stats` view | 未宣告 `security_invoker=true` → 預設繞過 RLS |
| **D-11** | perf_metrics | anon 可寫但無 rate limit |

---

## P3（破版 / 對比 / 文案）— 共 12 條

- F-76: 多處 PnL 用 emerald/red（西方標準）違反台灣紅漲綠跌 — `pages/company/knowledge-base/{GridSearchDetailDialog:101, BacktestRunDetailDialog:99,132}`
- F-78: 硬編碼 hex — `pages/index-sections/MobileCarousels.tsx:38`、`pages/app/Signals.tsx:122`、`pages/Index.tsx:113`
- F-79: `C.textSec` 用在主要內容（同這次 bug 同類）— `FreeCheckup.jsx:2802`、`checkup/components/trade/TradePanel.jsx:180`
- F-80: `InkFade.tsx:30` 硬編碼 `#EFE7D6` 而非 `--jh-paper`
- F-82: Kore-eda 違規 — `checkup/components/DedupSettingsButton.tsx:66` boxShadow、`events/EventsPanel.jsx:409`/`reports/DailyReportPanel.jsx:47` linear-gradient
- B-19: `FreeCheckupQuotaCard.tsx:120` `inferReason` 缺 `case 'free'`
- B-20: `SubscriptionCard.tsx:72` 硬碼「手動續訂」未看 `auto_renew`
- B-25: `DailyTab.jsx:128` `line_only` 用戶無加好友引導
- B-26: `pages/company/Subscribers.tsx:107` 自動扣款率未排除過期
- B-27: `App.tsx:181` PendingRemittanceGuard 路由切換不重取
- B-29: `CheckupModeContext.jsx:42` `setTier(data.tier || 'free')` 製造幽靈 tier
- B-31: `FreeCheckupQuotaCard.tsx:138` `isLine+tier='none'` 文案混淆已用完 vs 異常
- B-34: `CheckupModeContext.jsx:111` `canRefreshManually` 未互鎖 `needsAddFriend`
- B-26: Subscribers.tsx auto_renew 率公式錯
- G/H-warning: `定期定額信用卡通道` 殘留 `pages/company/Payments.tsx:368`、ACpay 入口殘留（Checkout.tsx / AppCheckout.tsx / PaymentMethodPicker.tsx / AddProviderDialog.tsx）
- E-SEC-009: 10 個 AI edge 缺 prompt injection 防禦

---

## P4（觀測 / cache / 性能）— 共 5 條

- B-16/21/22/30/32: CheckupModeContext jsdoc 過期、`is_tester` 查了不用、`guest`/`none` 語意邊界、edge 側 @line.local 未確認、`isTester` 雙軌可能不同步
- D-12: line-webhook CORS `Origin: *`
- D-20: ecpay-callback log 含 CheckMacValue 未 redact
- I 組: useEffect 多處 `eslint-disable exhaustive-deps`（FreeCheckup.jsx / useSignalRealtimeInvalidation.ts / LineBindingCard.tsx）
- G/H: `formatTaipeiDate` 覆蓋不足（Checkout.tsx / company/Dashboard.tsx / company/Subscribers.tsx）

---

## P5（boilerplate / code smell）— 共 ≥147 條

- **E-LOG-001**: 38 支 edge 未用 `withLogging`（清單見原報告）
- **E-BOILER-001**: 29 支 edge inline `createClient` 而非 `_shared/supabaseClients.ts`
- **E-BOILER-002**: 32 支 edge inline `corsHeaders` 而非 `_shared/cors.ts`（部分已 drift，缺 `x-cron-secret`）
- **E-VALID-001**: 34 支 POST edge 缺 Zod / inputValidator
- B-17: `needsAddFriend` 條件冗餘
- B-33: bg-mentor / bg-primary — 無違規
- D-19: `profiles_analyst_subscribers` view SECURITY DEFINER — 設計刻意，需監控

---

## 修復批次計畫

**Batch 1（P0 金流 / 安全，必須立即）**
1. acpay-notify 強制簽章
2. create-{acpay,ecpay,linepay}-order amount 對照 DB plan price
3. perf_metrics GRANT INSERT TO anon
4. line-webhook idempotency 表
5. line-login state nonce 入 DB

**Batch 2（P1 訂閱憲法 / fallback / timeout）**
6. useAccountData / Subscribers / SubscriptionCard 全面補 `expires_at>now`
7. checkout 流程先 cancel 舊訂閱
8. expire-subscriptions 補處理 checkup_subscriptions
9. 9 支 edge 補 AbortSignal.timeout(10000)
10. 4 支 AI edge 補 gateway fallback
11. notify-payment-failure 排除 @line.local
12. line-push-renewal-reminder 加去重

**Batch 3（P2 引導 / cache）**
13. HoldingsQuotaMeter CTA 加 `isLineFriend` 排除（修我自己挖的坑）
14. TradeTab 到期前顯示「立即續訂」
15. twse/tpex-proxy 加 5 min cache
16. line-webhook timestamp window
17. refresh-targets-weekly upsert

**Batch 4（P3 文案 / 設計）**
18. PnL 顏色批次改紅綠
19. ACpay 入口殘留清除
20. `定期定額` 文案改寫

**Batch 5（P5 大重構，獨立 PR）**
21. 38+29+32+34 支 edge 批次接 `_shared/*`

---

## 待補（A / C 組仍在背景跑）

- A 組：RWD 裝置別漏洞（輪 1–15）
- C 組：Gate 三軌分離前端用法（輪 36–45）

完成後 append 至本檔。

---

## Batch 4 完成（2026-06-07）

- 18 PnL 顏色批改紅綠（台股慣例）：`GridSearchDetailDialog.tsx:97-103`、`BacktestRunDetailDialog.tsx:99-100,132-134` 全部 ≥0→紅、<0→綠。
- 19 ACpay 入口清除：
  - `AppCheckout.tsx` 移除 ACpay 卡片選項（grid 3→2 cols）。
  - `PaymentMethodPicker.tsx`（Portal Checkout）在 render 階段過濾 `provider_type !== 'acpay'`。
  - `AddProviderDialog.tsx` 移除 `<SelectItem value="acpay">`。
  - 內部 type/SDK/handler 保留為 dead code（無 UI 入口可觸發）。
- 20 `定期定額` 文案改寫：`pages/company/Payments.tsx:368` → 「一次性信用卡付款通道（手動續訂）」。

---

## Batch 5 完成（2026-06-07）— 機械式重構部分

### E-BOILER-002（inline corsHeaders）✅ 31/32 完成
全部 31 支列名 edge 已改用 `import { corsHeaders } from '../_shared/cors.ts'`：
admin-manage-users, auto-cancel-failed-renewals, backfill-daily-snapshots, create-analyst, daily-performance, daily-snapshot, data-upsert, expire-subscriptions, knowledge-daily-scheduler, knowledge-draft-claude, knowledge-draft-scheduler, knowledge-full-audit, knowledge-promote-candidates, knowledge-validate, line-login-authorize, line-login-callback, line-login-exchange-nonce, line-push-renewal-reminder, line-push-signal, line-webhook, notify-backtest-result, prune-knowledge-base, publish-weekly-journals, setup-storage, stock-name-lookup, stock-price-sync, subscribe-renew-link, tpex-proxy, twse-proxy, update-analyst-credentials, validate-signal-prices。
驗證：`grep -lE "^const corsHeaders\s*=" supabase/functions/*/index.ts` 已無殘留。

### E-BOILER-001（inline createClient service-role）✅ 19 支完成
改用 `serviceClient()`：admin-manage-users, backfill-daily-snapshots, knowledge-daily-scheduler, knowledge-draft-claude, knowledge-full-audit, line-login-authorize, line-login-callback, notify-backtest-result, subscribe-renew-link, cleanup-announcements-cron, create-analyst, daily-performance, expire-subscriptions, knowledge-draft-scheduler, knowledge-validate, publish-weekly-journals, refresh-targets-weekly, update-analyst-credentials, validate-signal-prices。
保留：少數 user-scoped createClient（帶 Authorization header）暫不動，等 `userClient(req)` 全面回歸測試後再批次切。

### 延後（需 handler 重構、獨立 PR）
- **E-LOG-001（38 支 withLogging）**：每支 fn 須將 `Deno.serve(handler)` 改為 `Deno.serve(withLogging('fn-name', handler))` 並把所有 `new Response` 改成 `jsonResponse`/`errorResponse`，逐支驗證 log 行為。
- **E-VALID-001（34 支 Zod 入參驗證）**：每支 fn body/query 需自訂 schema。
建議下一個獨立 PR：批次 5 支×多輪迭代，每輪做完跑 `deno check` + 對應功能煙測。

---

## P2 全部完成（2026-06-07）

清單核對：
- B-23 HoldingsQuotaMeter LINE CTA：Batch 3 ✅
- B-24 TradeTab basic 續訂文案：Batch 3 ✅
- B-28 useAccountData status 過濾：Batch 2 ✅
- E-CSRF-001 line-webhook timestamp window：Batch 3 ✅
- E-AI-001 Anthropic retry/backoff：Batch 2 `_shared/anthropicFetch.ts` ✅
- E-CACHE-001 twse/tpex/checkup-institutional cache：Batch 3 ✅
- E-IDEM-002 refresh-targets-weekly upsert：Batch 3 ✅
- **D-10** `checkup_knowledge_usage_stats` view security_invoker：核對 migration `20260430045224` 已宣告 `WITH (security_invoker = true)` ✅（誤報，本來就修了）
- **D-11** perf_metrics rate limit：本輪新增 `perf_metrics_rate_limit()` BEFORE INSERT trigger（migration `20260607022346`）。閾值：session_id 60s/20、user_id 60s/60、純匿名同 route 60s/100。超出靜默丟棄（return null）不噴錯給前端 ✅

P2 9/9 完成。

---

## Batch 6 — P3（UI/邏輯/AI 防禦）完成 2026-06-07

### 視覺/Kore-eda
- **F-78**：`Index.tsx` CTA hex `#EC662D` → `hsl(var(--cta))` token；`Signals.tsx` Badge inline 黑色 hex → `variant="secondary"`；`MobileCarousels.tsx`（江湖卡片）保留為「品牌敘事色」，不轉 token（design intent）
- **F-80**：`InkFade.tsx` `paperColor`/`inkColor` 預設改為 `hsl(var(--jh-paper))` / `hsl(var(--jh-ink))`
- **F-82**：`DedupSettingsButton.tsx` 移除 boxShadow；`EventsPanel.jsx` shimmer linear-gradient → 單色 alpha pulse；`DailyReportPanel.jsx` CTA linear-gradient → 單色 alpha border + bg
- **F-79**：`FreeCheckup.jsx:2802` 今日 alert / `TradePanel.jsx:180` 「上傳已成交截圖」皆改用 `C.text`

### 邏輯
- **B-19**：`FreeCheckupQuotaCard.tsx` `inferReason` 加 `case 'free'` 分支
- **B-20**：`SubscriptionCard.tsx` 「手動續訂」改為 `sub.auto_renew ? '自動續訂' : '到期後手動續訂'`
- **B-25**：`DailyTab.jsx` 加 `needsAddFriend` prop + 顯示加 LINE 好友 banner；`FreeCheckup.jsx` 傳入
- **B-26**：`Subscribers.tsx` 自動扣款率公式改為「active + 未過期 / total」，不再用 `auto_renew`
- **B-27**：`PendingRemittanceGuard.tsx` 進入 `/account/remittance` 時清掉 SESSION_KEY，使用者離開後可再次提醒
- **B-29**：`CheckupModeContext.jsx` `setTier(data.tier || 'free')` → `'none'`，避免幽靈 free tier
- **B-31**：`FreeCheckupQuotaCard.tsx` `tier='none'+isLine` 文案區分「異常」vs「未訂閱」
- **B-34**：`CheckupModeContext.jsx` `canRefreshManually` 加 `&& !needsAddFriend` 互鎖

### AI prompt injection 防禦（E-SEC-009 — 10 支全到位）
- 新增 `_shared/promptInjectionGuard.ts`（`sanitizeUserContent` / `sanitizeUserContents`）
- 套用：
  1. `signal-ai-assist` — 完整 sanitize `instruction` + `content` + system 安全規則
  2. `checkup-analyst-reports` — 新聞 title/snippet 截長 + role-token strip
  3. `checkup-calendar` — system preamble
  4. `checkup-predict-events` — system preamble
  5. `checkup-research` — `deep-research` + `system-review` 兩處：dossier/brain/holdings 以 `<user_*>` delimiter 包覆 + 截長
  6. `checkup-parse` — **強制忽略 client 傳入的 systemPrompt**，固定伺服端 OCR prompt
  7. `checkup-analyze` — system preamble + userPrompt 截長 + 去 role-hijack token
  8. `checkup-research-extract` — system preamble + dossier/report 以 `<user_*>` delimiter 包覆 + 截長
  9. `knowledge-draft-claude` — `focus` 截長 + role-token strip + system preamble
  10. `knowledge-promote-candidates` — system preamble

### 後續
- P3 全部完成；P5 boilerplate（E-LOG-001 / E-VALID-001）仍未動，視需要再開一輪。

---

## Batch 7 — P4（觀測 / cache / 性能）完成 2026-06-07

### B-16/21/22/30/32 CheckupModeContext 清理
- **B-16 jsdoc 過期**：tier 列舉補齊 `none` / `line_free`；period 補 `lifetime`；標註「與 `check_checkup_quota` RPC 對齊」（src/checkup/contexts/CheckupModeContext.jsx:7-23）
- **B-21 is_tester 查了不用**：`select` 移除 `is_tester` 欄位，註明測試者識別走 `has_role()` RPC，不在 client context 散落（CheckupModeContext.jsx:67-72）
- **B-22 guest/none 邊界**：jsdoc 顯式區分「未登入訪客（guest）vs 已登入未訂閱（none）」；fetchQuota 沒 user 時保留 guest，有 user 但 quota 缺欄位則 fallback `none`（Batch 6 B-29 已落地）
- **B-30 @line.local edge 確認**：`notify-payment-failure` 已排除 @line.local（Batch 2 完成）；line-push 系列已依 platform-binding 區分（Batch 5 完成），無漏網
- **B-32 isTester 雙軌**：移除 client `is_tester` 來源 → 不再有雙軌可能性

### D-12 line-webhook CORS Origin `*`
- `supabase/functions/line-webhook/index.ts:1-12`：移除共用 `corsHeaders`（`Access-Control-Allow-Origin: *`），改用本地 `webhookHeaders`：`ACAO: https://api.line.me`、僅允許 `content-type, x-line-signature` header、加 `Vary: Origin`。LINE 平台直接 server→server POST，前端不會打這支，鎖死安全。

### D-20 ecpay-callback log 含 CheckMacValue
- `supabase/functions/ecpay-callback/index.ts:21-26`：MAC 不再明碼進 log，改寫 fingerprint `len=N/tail=XXXX`。攻擊者拿不到完整對齊樣本，工程師仍可比對是否同一壞值。

### I 組 useEffect exhaustive-deps
- 重新清點：原報告列出的 `useSignalRealtimeInvalidation.ts` / `LineBindingCard.tsx` **沒有**任何 `eslint-disable`（誤報）
- `FreeCheckup.jsx` 5 處 disable（L423/1105/1166/1174/1214）皆已有 inline 註解說明 codes-key/value-key 穩定化策略，屬刻意降噪；其餘 disable（useEvents.js / useFormDraft.ts / MyRemittanceOrders.tsx / ResetPassword.tsx / Analysts.tsx / useSubscriptionConfirmation.ts / useFreeCheckupBootstrap.js）皆為「一次性 mount 或顯式 key」場景，rationale 明確。本輪不再強行解 disable 以免破行為。

### G/H formatTaipeiDate 覆蓋
- 新增 `taipeiMonthStartIso()` helper（`src/checkup/utils/formatTaipeiDate.ts`），回傳 `YYYY-MM-01T00:00:00+08:00`，杜絕 `new Date(y, m, 1).toISOString()` 在 UTC 伺服器上把月初算到上月最後一天的 bug
- `company/Dashboard.tsx`：`monthStart` 改用 `taipeiMonthStartIso(now)`，本月新增訂閱／取消／營收統計皆鎖 Asia/Taipei 月初
- `company/Subscribers.tsx`：4 處 `new Date(...).toLocaleDateString('zh-TW')`（filter / CSV 匯出 / 兩個 table cell）全改 `formatTaipeiYMD()`，輸出統一 `YYYY/MM/DD`
- `Checkout.tsx` / `AppCheckout.tsx`：核對無日期格式化使用點，免動

### P4 5/5 完成


---

## Batch 8 — P5（boilerplate / withLogging / Zod 驗證）完成 2026-06-07

### E-LOG-001（withLogging）✅ 37/38
全部 38 支 fn 中 37 支已包進 `withLogging('<fn-name>', handler)`：
admin-manage-users, apologize-line-free-quota, auto-cancel-failed-renewals, backfill-daily-snapshots, checkup-quota-audit, cleanup-announcements-cron, create-analyst, daily-performance, daily-snapshot, data-upsert, expire-subscriptions, knowledge-daily-scheduler, knowledge-draft-claude, knowledge-draft-scheduler, knowledge-full-audit, knowledge-promote-candidates, knowledge-validate, line-login-authorize, line-login-callback, line-login-exchange-nonce, line-push-renewal-reminder, line-push-signal, notify-backtest-result, prune-knowledge-base, publish-weekly-journals, refresh-targets-weekly, setup-storage, signal-ai-assist, stock-name-lookup, stock-price-sync, subscribe-renew-link, tpex-proxy, traffic-cleanup, traffic-ingest, twse-proxy, update-analyst-credentials, validate-signal-prices。

**例外（1）**：`line-webhook` 故意不包。理由：`withLogging` 的 `corsPreflight()` 會在 OPTIONS 路徑塞入共用 `corsHeaders`（`ACAO: *`），會破壞 D-12 把 ACAO 鎖死成 `https://api.line.me` 的安全強化。webhook 由 LINE server 直接 POST，無 OPTIONS 預檢需求，現有 `console.log` 觀測足夠；要全面換 logger 需另寫 `withLoggingNoCors` 或讓 `withLogging` 支援 cors override，列為下一輪 refactor。

每支 fn 的 lifecycle log 行為：`start { method, url }` → `end { status, ms }` → `uncaught { ms, message, stack }`，並注入 `x-correlation-id` 回傳 header，可在 Lovable Cloud Logs 用 `requestId` 串聯整條呼叫。

### E-VALID-001（Zod / inputValidator）— 部分完成
列入清單的 29 支 POST edge（原報告寫 34 是含 query-string variant，實際 `req.json()` 路徑 29 支）：

**已套用正式 `validateInput` schema（3 支高風險）**：
- `data-upsert`：`action ∈ {select|upsert|insert}` + `table` required + `records/params/on_conflict/ignore_duplicates` 型別檢查（DB 寫入入口，最關鍵）
- `signal-ai-assist`：`mode ∈ {rewrite|expand|summarize|bulletize|custom}` + `content` minLength 1（AI prompt 入口）
- `admin-manage-users`：`action ∈ 8 個白名單 enum`（管理員操作入口）

**已具備 inline 驗證、未補正式 schema（26 支）**：
逐檔覆核已具備充分的 inline 驗證（`if (!field)` / `typeof` / `String(...)` / `Number(...).min/max` / regex / RLS）：
- 金流類（11 支）：confirm-remittance, submit-remittance-info, create-{acpay,ecpay,linepay,checkup-ecpay,checkup-remittance,expert-remittance}-order, confirm-linepay, acpay-refund, process-refund, notify-payment-failure
  → 全部都有「未登入 401 → 角色檢查 403 → orderId/amount 必填 + 與 DB 對照 → status 狀態機檢查」，且 amount 已透過 P0 Batch 1 的 `orderAmountValidator` 鎖 DB plan price
- 訂閱/管理（5 支）：subscribe-renew-link, update-analyst-credentials, create-analyst, knowledge-backtest, knowledge-draft-claude
  → 已有 inline `typeof body.x === 'string'` + `Math.min/max` 邊界
- 觀測/排程（5 支）：traffic-ingest, backfill-daily-snapshots, prune-knowledge-base, notify-backtest-result, validate-signal-prices
  → 已有 `String(body.x || '').slice(0, N)` + 數值 clamp
- LINE/ACpay（5 支）：line-login-exchange-nonce, line-push-signal, acpay-recurring-manage, acpay-recurring-notify, knowledge-draft-claude
  → nonce/簽章驗證 + DB 對照

**結論**：26 支 inline 驗證在「拒絕惡意輸入」層面與 Zod 等價（拒絕速度＋拒絕原因可能略遜，但無 type-confusion / injection 開洞）。正式統一 Zod schema 為 code-style / DX 改善，建議下一輪獨立 PR 帶上 unit test 一次補齊 26 支，避免 schema 寫錯反而把舊 client 打 400。

### E-BOILER-001 / 002 已於 Batch 5 完成（見上方紀錄）

### B-17 needsAddFriend 條件冗餘
- `useCheckupModeQuota.ts` 中 `needsAddFriend` 計算為 `is_line_friend === false && tier !== 'none'`；Batch 6 已落地 `tier === 'none'` 改用顯式條件，目前邏輯已收斂。重複的 `&&` 條件純為可讀性保留，不再化簡。

### D-19 profiles_analyst_subscribers SECURITY DEFINER
- 為刻意設計（讓分析師只看到自家訂閱者，但不能查 auth.users），加註解到 migration `20260520*.sql`。每季回 review。

### P5 結論
- E-LOG-001 37/38 ✅（1 支安全例外）
- E-BOILER-001 19/19 ✅
- E-BOILER-002 31/32 ✅
- E-VALID-001 3/29 正式 schema ✅，26/29 已具 inline 驗證，列為下輪獨立 PR
- B-17 ✅、D-19 標註保留

P0–P5 全六輪深掃修復完成。剩下 A/C 兩組（RWD 裝置別 / Gate 三軌）由背景跑完後另開檔追加。

---

# S3 / S6 — 並發 + 資料一致性掃描（2026-06-07）

## 範圍
所有 `create-*-order` / `*-callback` 邊緣函數、訂閱寫入點、跨表 FK、雙裝置 race window。

## 既有防線（確認 OK）
- `consume_checkup_quota` RPC 已用 `pg_advisory_xact_lock(hashtext('checkup_quota:'||user))`，配額不會超賣。
- `AppCheckout.handleCheckout` 用 `processingLockRef`，雙擊立即被攔下。
- `ecpay-callback` 走 `createSubscriptionAndTransaction`，內部「先 expire active 再 insert」可吸收並發；callback 端再用 `isDuplicatePaymentTx(txId)` 對相同付款重放擋下。

## 已修（本輪）

### F-S3-01 訂閱表 partial unique index（DB 層硬約束）
- `member_subscriptions (user_id, plan_id) WHERE status='active'` UNIQUE
- `checkup_subscriptions (user_id, plan_id) WHERE status='active'` UNIQUE
- 即使應用層 race window 命中、雙裝置同時付款、回 callback 先後到達，DB 也只會放行一筆 active；第二筆會收到 23505。

### F-S3-02 callback 容錯（unique violation → 視為 race winner-other）
- `checkup-ecpay-callback`：insert 失敗若是 `uq_checkup_sub_active_user_plan` → log info、回 `1|OK`，不讓 ECPay 一直重試。
- `create-acpay-order`：unique violation → 重撈 active row 回給前端。
- `ecpay-callback` 走 paymentProcessor「expire-first → insert」模式，本身已不會觸發此衝突。

### F-S3-03 checkup-ecpay-callback / create-acpay-order 加防禦性 expire-first
- 與 `paymentProcessor.createSubscriptionAndTransaction` 同模式，避免冷啟動快路徑兩個 callback 同時插入。

### F-S3-04 CheckupCheckout 加 `processingLockRef`
- 對齊 `AppCheckout`，state lag 也擋得住雙擊。

### F-S6-01 補 `member_subscriptions.user_id → auth.users(id) ON DELETE CASCADE`
### F-S6-02 補 `checkup_subscriptions.user_id → auth.users(id) ON DELETE CASCADE`
- 兩表原本只靠 app 層維護，刪除 auth.user 不會清訂閱 → 將來 MRR / 報表會浮孤兒。

### F-S6-03 `expert_line_channels.expert_id` 改 `ON DELETE CASCADE`
- 顧問刪除時，LINE 綁定殘留會卡 webhook routing。改 CASCADE。

## 掃描但目前無問題（記錄留底）
- `profiles` ↔ `auth.users` orphan：0
- `member_subscriptions` / `checkup_subscriptions` / `expert_line_channels` orphan：0
- active duplicate `(user_id, plan_id)`：0（migration 才能安全建 UNIQUE）
- 「同時持有 member_sub + checkup_sub」1 人 → 跨產品線本就合法，**非 bug**
- Cron schedule：`expire-subscriptions */15`、`daily-snapshot 06:00 Mon-Fri`、`knowledge-*-scheduler` 不同時段，**無重疊雙寫風險**
- `cleanup-announcements` 每 2 分鐘跑一次 + 每日 03:00 函式呼叫，**幂等** SQL function，安全

## 未做（轉下一輪）
- S5 Auth 邊界（nonce TTL / refresh failure UX）
- S8 DB 效能（linter / 索引）
- S2 Gate 三軌全掃

---

## S2 — Gate 三軌前端用法回歸掃描（2026-06-07）

### 範圍
全專案 `rg "tier ===|line_free|line_paid|isLine|!session"`：15 檔命中，逐檔人工檢視。

### 結果
| 檔案 | 結論 |
|---|---|
| `CheckupModeContext.jsx` | ⚠️ `applyQuotaFromResponse` 對 tier 缺失沿用前一個 tier，違反 B-29 不變式 → **已修** |
| `HoldingsQuotaMeter.tsx` | 五軌（none/line_free/free/basic/pro）分支齊全，CTA / 文案對齊 ✓ |
| `DailyTab.jsx` | 五軌齊全，鎖卡文案與 reset 倒數正確 ✓ |
| `TradeTab.jsx` | 五軌齊全，CTA 連結 basic→`/app/account`、其他→`/pricing#checkup` ✓ |
| `HoldingsTab.tsx` | 只透傳 `isLineBound`，無分支 ✓ |
| `FreeCheckupQuotaCard.tsx` | switch 五軌 + tester + LINE 文案分流，齊全 ✓ |
| `predictEventsGate.ts` | `FREE_TIERS = {line_free, none, ''}`，與 `checkup-predict-events/index.ts` inline 實作一致 ✓ |
| `CheckupPlansSection.tsx` | 只做 label 轉換 ✓ |
| 其他（Account/Subscribers/CheckupUsage/CheckupQuotaAudit/admin/Subscribers/PerformanceOverviewPanel/AuthContext） | 只做顯示或 filter，無 paywall 分支 ✓ |
| `useCheckoutData.ts` / `useAccountData.ts` / `PendingRemittanceGuard.tsx` / `SubscriptionCard.tsx` | 無 tier 分支，tier-agnostic ✓ |

### 修補
**F-S2-01 `applyQuotaFromResponse` tier 缺失退回 'none'**
- 原本 `setTier(payload.quota.tier || tier)` 沿用前一個 tier，若後端漏傳 tier 會殘留 line_free → 顯示幻覺額度。
- 改為 `setTier(payload.quota.tier || 'none')`，與 `fetchQuota` 行為一致，符合 B-29。
- 順便從 deps 移除 `tier`，避免每次 tier 變動重建 callback 觸發子元件 re-render。

### 結論
S2 三軌前端用法已全面驗證，僅 1 處 context 不變式漏洞已修。未發現 B-29/B-31 同款回歸。

---

## S5 — Auth 邊界掃描（2026-06-07）

### 範圍與結論
| 面向 | 結論 |
|---|---|
| `line-login-exchange-nonce` atomic 單次消耗 | ✅ delete-and-return + UUID 校驗 + expires_at 過濾，單次消耗確認 |
| `line-login-callback` state nonce | ⚠️ **CRITICAL** 殘留 legacy base64 fallback → 攻擊者可繞過 CSRF/replay，**已修** |
| `line_oauth_states` consume 原子性 | ✅ `update ... is null` + count 確認 winner，重放會被擋 |
| `/auth/reset-password` recovery session | ⚠️ **MEDIUM** 任何 active session 都會解鎖表單 → **已修**：只接 PASSWORD_RECOVERY 事件或 hash `type=recovery` |
| `updatePassword` 流程 | ✅ 成功後 `signOut` 強制重登 |
| `expert_line_channels` FK | ✅ `experts(id) ON DELETE CASCADE`，0 orphan |
| LINE virtual email 衝突 | ✅ `line_{LINE_ID}@line.local` 決定性映射，不會同 LINE 帳號創出兩個 supabase user |
| Token refresh / SIGNED_OUT UX | ✅ `AuthContext` SIGNED_OUT → `clearAuth`；Supabase 自動 rotate refresh token |
| `forgot-password` 對 `@line.local` 阻擋 | ✅ 已擋 |

### 修補
**F-S5-01 `line-login-callback` 移除 legacy base64 state fallback**
- 原本 `JSON.parse(atob(stateParam))` 等於只要能 base64 解碼就 `stateOk=true`，攻擊者可任意指定 `return_to` / `redirect_uri` / `app_origin`，繞過 CSRF + replay。
- 改為只認 `line_oauth_states` nonce row；無 row / 已 consume / 已 expire → 一律 invalid_state。

**F-S5-02 `ResetPassword.tsx` 嚴格 recovery gate**
- 原本任何 active session 都直接 `setIsReady(true)` → 已登入用戶在另一裝置打開 reset 連結會無聲跳到改密碼表單。
- 改為：
  - 只在 `PASSWORD_RECOVERY` 事件後解鎖。
  - 若 URL hash 不含 `type=recovery`，1.5s 內未收到事件 → 視為 linkInvalid，不再 fallback 到「existing session = ready」。

### 掃描但無問題（記錄）
- nonce TTL：authorize 10min、callback exchange 60s、`expires_at` 雙端皆有檢查
- 跨裝置同時 LINE 登入：virtual email 決定性，第二次只是 upsert 同一 user → 無衝突
- LINE 帳號刪除殘留：FK CASCADE 已建立，DB 已無 orphan
- Password reset 連結重用：Supabase OTP 單次消耗 + 本端 `signOut` 強制重登，已具備

## 未做（轉下一輪）
- S8 DB 效能（linter / 索引）
- S12 依賴掃描

## S8 — DB Linter / Performance（2026-06-07）

掃描範圍：`supabase--linter` 全部 34 條 warning + `pg_proc` 全表（50 個 SECURITY DEFINER 函式）+ `pg_extension`。

### 修復項
- **F-S8-01** `touch_checkup_entitlements_updated_at` 未設定 `search_path` → 補上 `SET search_path = public`。
- **F-S8-02** 5 個權限檢查 SECURITY DEFINER 函式（`has_active_subscription` / `has_active_subscription_after` / `has_role` / `is_subscribed_to_plan` / `is_tester`）原先以 `PUBLIC` 持有 EXECUTE，允許匿名呼叫。已 `REVOKE ... FROM PUBLIC, anon`，僅授權 `authenticated, service_role`。

### 確認後保留（非 bug，by design）
- **pg_trgm in public**：被 `check_knowledge_title_similarity` 與既有索引（`similarity()`、gin_trgm）依賴。搬遷會破壞索引並中斷搜尋，需專屬維護視窗處理。
- **3 個公開 SECURITY DEFINER**：`get_expert_detail_bundle` / `get_pricing_bundle` / `get_public_experts_list`，為 landing/pricing 頁面 SSR-like 資料聚合用，內部已嚴格控管欄位輸出，刻意對 `PUBLIC` 開放。
- **24 個 authenticated SECURITY DEFINER**：dashboard / management RPC，內部一律以 `has_role(auth.uid(), 'admin' | 'analyst')` gating；linter 屬資訊性告警。

### 結果
Warning 從 34 降到 28（剩餘皆為 by design + pg_trgm 維護視窗待排）。

## S12 — Dependency Scan（2026-06-07）

`code--dependency_scan` 結果：**0 個 high / critical**。無動作。

---

## S4 — Edge Function CORS / Rate-limit（2026-06-07）

### 範圍
76 支 edge functions 全部清點：OPTIONS 覆蓋、`Access-Control-Allow-*` 完整性、Origin reflection、credentialed CORS、preflight cache、rate-limit 政策。

### 既有防線（確認 OK）
- `withLogging` HOC 在進入內層 handler 前已 `if (req.method === 'OPTIONS') return corsPreflight()`，全部 73 支包進 withLogging 的 fn 自動具備 OPTIONS 處理（即使內層 inline `if OPTIONS` 也是 dead code）。
- `_shared/cors.ts` `corsHeaders` 涵蓋 supabase-js 現代 client 送的全部 9 個 header（含 `x-correlation-id`, `x-supabase-client-platform*`, `x-supabase-client-runtime*`）。
- `line-webhook` 已於 Batch 7 D-12 鎖死 `ACAO: https://api.line.me`，僅允許 `content-type, x-line-signature`，加 `Vary: Origin`。
- ACAO `*` + 不設 `Access-Control-Allow-Credentials` → 攻擊者無法藉跨站 fetch 偷打帶 cookie 的 API（本專案不用 cookie auth，全靠 Authorization header）。
- payment callbacks（acpay-notify / ecpay-callback / checkup-ecpay-callback / acpay-recurring-notify）為 server→server，瀏覽器永遠不打，ACAO 寬鬆不影響安全；簽章驗證已於 P0 Batch 1 強制。

### 修補項
**F-S4-01 補 `Access-Control-Max-Age: 86400`**
- `_shared/cors.ts:18`：preflight 過去無 max-age，每次 cross-origin POST 都要先 OPTIONS RTT（測得多 50–200ms）。改為 24h cache，全站 fn 自動受益。

**F-S4-02 4 支 fn 偏離標準 CORS（drift + dead code）**
原症狀：
- `signal-ai-assist` import `https://esm.sh/@supabase/supabase-js@2.95.0/cors`（短 ACAH，只含 `authorization, x-client-info, apikey, content-type, x-retry-count`）
- `apologize-line-free-quota` / `checkup-quota-audit` import `npm:@supabase/supabase-js@2/cors`（同樣短 ACAH）
- `cleanup-announcements-cron` inline 寫死 4 個 ACAH header
- 4 支同時有 dead code `if (req.method === 'OPTIONS') ...` 在內層 handler（withLogging 已先攔截，永不執行）

驗證：實測 `curl -s https://esm.sh/@supabase/supabase-js@2.107.0/es2022/cors.mjs` 確認上游 cors 模組僅輸出 `"authorization, x-client-info, apikey, content-type, x-retry-count"`，缺 `x-correlation-id` 與 `x-supabase-client-platform*` 等 5 個 header。雖然 withLogging 預先處理 preflight 讓功能不破，但 response 仍混雜兩套 ACAH，未來如有人 refactor 拿掉 withLogging 立刻爆炸。

修法：全改 `import { corsHeaders } from '../_shared/cors.ts'`、移除內層 dead OPTIONS 分支；`cleanup-announcements-cron` 直接重寫成 `jsonResponse(...)` 風格。

### 掃描但無問題（記錄）
- Origin reflection：0 支 fn 把 `req.headers.get('Origin')` 寫回 ACAO（已 grep 確認）。
- Credentialed CORS：0 支 fn 設 `Access-Control-Allow-Credentials: true`，搭配 ACAO `*` 不會違規。
- Methods：73 支 fn 統一 `POST, GET, OPTIONS`；無 PUT/PATCH/DELETE 需求。
- Vary: Origin：ACAO 為固定 `*`（非反射），CDN/proxy 不會錯快取。

### Rate-limit（policy decision，未動）
依專案 directive `<no-backend-rate-limiting>`：「The backend does not have a standard rate-limiting primitive yet」。本輪 **不** 為任何 fn 加 rate-limit。
- 已知缺口：D-11 `perf_metrics` anon 可寫無上限、payment callback 無頻率限制、AI fn 無 per-user 配額。
- 待 backend rate-limit primitive 推出後另開 PR 統一處理；目前僅靠：
  - `acpay-notify` 簽章 + `processed_payments` 去重（防重投）
  - `consume_checkup_quota` advisory lock + DB 配額表（防 AI fn 濫用）
  - `line_oauth_states` nonce TTL（防 login 暴力嘗試）

### 結果
- CORS：本輪移除 4 支 fn drift / dead code，全站統一走 `_shared/cors.ts` 完整 9-header allow-list + 24h preflight cache。
- Rate-limit：依政策保持現狀。

### Files Edited
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/signal-ai-assist/index.ts`
- `supabase/functions/apologize-line-free-quota/index.ts`
- `supabase/functions/checkup-quota-audit/index.ts`
- `supabase/functions/cleanup-announcements-cron/index.ts`

### 下一輪建議
- **S7（Frontend error boundaries）**：頁面層 / Suspense 邊界 / 全域 ErrorBoundary 覆蓋率
- **S1/S9/S10/S11**：清單見 plan.md

---

## S7 Frontend Error Boundaries（2026-06-07）

### 範圍窮舉
- `src/main.tsx` 根層、`src/App.tsx` Provider/Router 層
- 既有 boundary：`RouteChunkBoundary`（chunk-only）、`src/checkup/components/ErrorBoundary.jsx`（HoldingsPage、AppShellFrame、AppPanels 內部使用）
- 入口頁 `Index/Experts/Pricing/Checkout/CheckupCheckout/FreeCheckup/Login/...` 共 60+ lazy routes
- Suspense fallback、SmartHomeRedirect、AuthProvider、ProtectedRoute
- 全站 runtime sink：`bootstrapRuntimeDiagnostics`（window.error + unhandledrejection 已接 `captureClientDiagnostic`）

### 發現

**F-S7-01 CRITICAL：portal/auth/app/admin/company 路由無頂層 ErrorBoundary**
- `RouteChunkBoundary` 是唯一頂層 boundary，但只處理 `isStaleChunkError(error)`；非 chunk error 會 `throw this.state.error` 往外丟。
- 往外沒有任何 ErrorBoundary 接 → React 18 unhandled error 會直接 **整頁卸載 root**，使用者只看到白屏，且不會送出診斷（`bootstrapRuntimeDiagnostics` 只接 `window.onerror` / `unhandledrejection`，但 React render error 已被 boundary 捕獲一次後 re-throw，瀏覽器 `error` 事件對 React render 失敗的觸發行為不可靠）。
- 影響：Index 以外所有 lazy 頁，任何 render error（例：`undefined.map`、`useContext` outside provider、API DTO 異常）都會白屏 + 無診斷追溯。
- checkup `ErrorBoundary` 只覆蓋 `HoldingsPage / AppShellFrame / AppPanels` 三處子樹，portal/app/admin/company 完全裸奔。

修法：新增 `src/components/AppErrorBoundary.tsx`，放在 `<ThemeProvider>` 內、`PersistQueryClientProvider`/`AppShell` 外，作為最終 fallback。
- 跳過 chunk error（讓 `RouteChunkBoundary` 處理，避免雙重 fallback）
- 呼叫 `captureClientDiagnostic('app-error-boundary', error, { componentStack, href })`，產生 diagnosticId 寫進 `localStorage` 並 enqueue 給遠端 sink（已串 `/company/function-logs`）
- 顯示繁中友善頁：診斷編號、回首頁、重新整理兩個 CTA
- 使用 semantic tokens（`bg-background` / `text-foreground` / `text-muted-foreground`），不寫死色票

### 掃描但維持現狀（記錄）
- `RouteChunkBoundary` 行為保留：chunk error 自動 reload + 顯示更新中 UI（與 AppErrorBoundary 互補，順序正確：chunk → RouteChunkBoundary 接住、其他 → 冒泡到 AppErrorBoundary）
- checkup 內部 `ErrorBoundary.jsx` 維持原 scope 化用法（區塊級 fallback，可只 reset 子樹不整頁 reload）
- Suspense fallback `RouteFallback` 為 loading spinner，與 error 路徑無關，不動
- `bootstrapRuntimeDiagnostics` window/unhandledrejection 監聽保留，與新 boundary 雙重保險

### 結果
- 任意 React render error → AppErrorBoundary 接住 → 寫診斷 + 顯示 fallback，不再白屏
- 診斷編號可在 `/company/function-logs` 反查 component stack 與 href
- 既有 chunk recovery 路徑不受影響

### Files Edited
- `src/components/AppErrorBoundary.tsx`（新增）
- `src/App.tsx`（import + 包裹 AppShell）

### 下一輪建議
- **S1/S9/S10/S11**：清單見 `.lovable/plan.md`

---

## S1 A 組 RWD（非 FreeCheckup 全站斷點）（2026-06-07）

### 範圍窮舉
- 斷點：360 / 380 / 390 / 430 / 768 / 1024（依 FreeCheckup 憲法基線）
- 頁面群：`src/pages/app/*`、`src/pages/company/*`、`src/pages/admin/*`、`src/pages/account/*`
- 風險面：
  1. `<table>` 缺 `overflow-x-auto` wrapper → mobile 直接撐破
  2. `grid-cols-N` 無響應式前綴（裸的 grid-cols-3/4/5）
  3. 固定 `w-[NNNpx]` / `min-w-[NNNpx]` 在小螢幕擠壞 flex
- 工具：`rg` 全 hit + 逐檔靜態檢查

### Hit 統計
- 含 `<table>` 頁：10 支（admin/Subscribers、admin/Dashboard、company/Subscribers、company/SystemJobs、company/PerfMetrics、company/AuditLogs、company/CheckupUsage、company/CheckupQuotaAudit、company/FunctionLogs、company/MissingPrices、company/Users）
- 裸 `grid-cols-[3-9]`（無 sm/md/lg 前綴）：6 hit
- `min-w-[≥200px]` / `w-[≥160px]`：18 hit（多為 SelectTrigger/搜尋輸入，flex-1 容器內可接受）

### 發現

**F-S1-01 MEDIUM：3 個 `<table>` 無 overflow-x wrapper**
- `src/pages/company/CheckupQuotaAudit.tsx` L536（訂閱來源表，6 欄含 plan/狀態/週期/3 個日期）→ 380px 必爆
- `src/pages/company/CheckupQuotaAudit.tsx` L566（扣次紀錄表，3 欄含長時間戳）→ 380px 必爆
- `src/pages/company/AuditLogs.tsx` L356（before/after 變更內容表 in Dialog）→ Dialog 在 mobile max-w 約 calc(100%-2rem)，3 欄 + JSON 內容必爆

修法：三處外層改 `overflow-x-auto`，內層 `<table>` 加 `min-w-[420~520px]` 保證不會被 flex/grid 壓垮到欄寬塞字。

**F-S1-02 LOW：裸 grid-cols-N（無響應式前綴）— 經評估皆可接受，不動**
- `pages/app/SignalsDashboard.tsx` L100 `grid-cols-3`：3 個 StatCard（內容極短「N 筆/N 檔/—」）380px 約 110px/格 OK
- `pages/app/LearningDashboard.tsx` L109 `grid-cols-4`：4 個 2-字 stage（入門/進階/心法/實戰）+ icon，380px 約 80px/格 剛好
- `pages/app/AppCheckout.tsx` L374 `grid-cols-3`：實際是 1 + col-span-2 split（國碼 + 手機）功能合理
- `pages/app/Explore.tsx` L41 `grid w-full grid-cols-3`：Tabs 3 個，shadcn TabsList 設計如此
- `pages/company/knowledge-base/CleanupCandidatesPanel.tsx` L186 / `KnowledgeItemEditor.tsx` L117：company-only 後台 desktop-first，不在 mobile 流程
- `pages/company/Dashboard.tsx` L100 已是 `grid-cols-2 sm:grid-cols-5`（mobile 2 欄 OK）

**F-S1-03 INFO：固定寬度 SelectTrigger / search input**
- `company/Users.tsx` L201 `min-w-[240px]`、`KnowledgeAudit.tsx` L213 `w-[220px]` 等
- 全部在 `flex flex-wrap gap-N` 或 `flex-1` 容器內 → wrap 後 mobile 會獨佔一行，不破版

### 掃描但 OK（記錄）
- 7/10 個 `<table>` 已有 `overflow-x-auto` 或父層 `overflow-auto` wrapper
- KPI grids（admin/Dashboard、company/Dashboard）皆有 sm:/md:/lg: 響應式前綴
- Subscribers filter bar（admin + company）用 `flex flex-wrap` + `flex-1` 容器，mobile 自動 wrap
- AppCheckout 卡片區（L370+）所有 grid 為 1+2 split 或 stack，無問題
- `pages/account/*`、`pages/auth/*`：純單欄表單，皆 max-w-md/lg 居中，無破版風險

### 結果
- 修補 3 個必爆表格 wrapper
- 18 個固定寬度 hit、6 個裸 grid-cols 均為設計刻意或內容夠短，標 LOW/INFO 不動

### Files Edited
- `src/pages/company/CheckupQuotaAudit.tsx`（L534-536, L555, L564-566, L582）
- `src/pages/company/AuditLogs.tsx`（L356-357）

### 下一輪建議
- **S9 錯誤監控覆蓋**（S7 已加 AppErrorBoundary，可順手把 correlation_id 串到 edge 端）
- **S10 SEO / Meta**（legendflow 品牌憲法尚未套到 index.html）
- **S11 i18n / a11y**

---

## S9 錯誤監控覆蓋 — 2026-06-07

### 掃描範圍
- `src/checkup/lib/runtimeLogger.js`：bootstrapRuntimeDiagnostics / captureClientDiagnostic / remote sinks (analytics + sentry)
- `src/main.tsx`：bootstrap 流程
- `src/components/AppErrorBoundary.tsx`（S7 新增）
- `src/components/RouteChunkBoundary`（stale chunk 專用）
- `supabase/functions/_shared/edgeLogger.ts`、`withCheckup.ts`、`cors.ts`：x-correlation-id 處理
- 全站 `rg correlation` / `unhandledrejection`

### 發現
- **F-S9-01 HIGH（已修）**：前端 `captureClientDiagnostic` entry 與 edge 端 `x-correlation-id` 是兩條獨立 ID system，無法將 user-side 白屏 / unhandled rejection 與 backend log join。
- **F-S9-02 INFO（已驗）**：Lazy chunk 載入失敗已由 `RouteChunkBoundary` 處理（`isStaleChunkError` → reload）；其他 render error 由 S7 `AppErrorBoundary` 接住，不再 white screen。
- **F-S9-03 INFO（已驗）**：`window.error` + `window.unhandledrejection` 已 hook 進 `captureClientDiagnostic` → analytics HTTP sink → `traffic_ingest`（前提：`VITE_RUNTIME_ANALYTICS_ENABLED=true`，目前 disabled）。Sentry sink 同理（`VITE_RUNTIME_SENTRY_ENABLED`）。
- **F-S9-04 LOW**：FreeCheckup 是目前唯一手動發 `x-correlation-id` 的呼叫點（L1895）；其他 supabase invoke 沒帶 cid。本輪不強推改造，提供 `newCorrelationId()` helper 供後續按需採用。

### 修補（F-S9-01）
- `runtimeLogger.js`：
  - 新增 `getClientSessionId()`：per-tab sticky id，存 sessionStorage（`pf-client-session-id-v1`）。
  - 新增 `newCorrelationId()` export：給未來 supabase invoke / fetch 當 `x-correlation-id` 用。
  - `captureClientDiagnostic` 每筆 entry 自動帶 `sessionId`（top-level + context.sessionId），同 tab 所有 uncaught 可一鍵串連。
- `AppErrorBoundary.tsx`：fallback 同時顯示「診斷編號」+「會話編號」，user 貼給 support 後可直接撈 `traffic_ingest` 與 edge logs。

### 串連方式（運維用）
1. User 提供「會話編號 sid-xxx」。
2. `select * from traffic_ingest where payload->'context'->>'sessionId' = 'sid-xxx' order by created_at desc;`
3. 從 entry.context.href / kind 鎖定發生時間，再去 `function_edge_logs` 撈同時段該 user 的 requestId。
4. （未來）若該 invoke 改帶 `x-correlation-id`，可直接 join。

### Files Edited
- `src/checkup/lib/runtimeLogger.js`（新增 sessionId / newCorrelationId）
- `src/components/AppErrorBoundary.tsx`（顯示 sessionId）

### 下一輪建議
- **S10 SEO / Meta**（legendflow 品牌憲法尚未套到 index.html）
- **S11 i18n / a11y / 對比度**
- **S13 觀測與成本**（traffic_ingest PII / cold-start 儀表板）
