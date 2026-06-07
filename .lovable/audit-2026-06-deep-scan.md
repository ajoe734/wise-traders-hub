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
