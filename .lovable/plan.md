# 全站深掃計畫 v2：100 輪 + Edge Functions 全納入 + P0–P5 嚴重度

## 根因抽象（這次低級錯誤）

`HoldingsQuotaMeter` 桌機看不到 LINE 登入按鈕，根因不是「漏寫按鈕」，是**反覆出現的反模式**：

> 行銷/引導/補救 UI 綁在**單一條件**（`DemoBanner` / `isMobile` / `isDemo`），
> 沒覆蓋正交狀態矩陣：`{裝置} × {登入態} × {綁定態} × {訂閱態} × {配額態} × {好友態}`。

人工逐頁看必漏。下面 100 輪 = 100 條不變式 × 全站窮舉掃描。

---

## 範圍（窮舉，含 Edge Functions）

**前端**
- `src/pages/**`（含所有 `_xxx/` 子資料夾）
- `src/checkup/**`（FreeCheckup 整包 + 6 tab + components/hooks/stores/lib）
- `src/components/**`、`src/hooks/**`、`src/contexts/**`、`src/lib/**`

**後端（39 個 edge functions 全部納入）**
- `supabase/functions/_shared/**`（cors/logger/clients/quota/auth）
- `supabase/functions/checkup-*/index.ts`（analyze / parse / calendar / predict-events / research / research-extract / brain / knowledge / telemetry / report / analyst-reports / twse / institutional / mops-* / sparkline / quota-audit / price-refresh / …）
- `supabase/functions/line-*`（login-authorize / login-callback / webhook / push-*）
- `supabase/functions/create-acpay-order` / `ecpay-*` / `payment-*` / `subscription-*` / `refund-*`
- `supabase/functions/cleanup-announcements-cron` / `expire-subscriptions` / `backfill-daily-snapshots` / `mentor-journal-cron` / `stock-name-lookup` / 其餘排程
- `supabase/migrations/**`（RLS / GRANT / has_role / security_invoker view）

---

## 100 輪掃描分組

### A. 裝置別 RWD 條件漏洞（輪 1–15）
1. `useIsMobile` / `useViewportWidth` / `innerWidth` 全用法 — 單向 render
2. `DemoBanner` 全 call site — CTA 是否唯一依賴
3. `md:hidden` / `hidden md:block` 含 CTA 的元素
4. 4 個 layout 桌機/手機 nav 對稱性
5. MobileCarousels 是否漏桌機等效資訊
6. `fontSize ≥ 32` 配 media query 憲法
7. `.wb-card` / `wb-hero-grid` 三斷點（560/390/380）
8. FreeCheckup 6 tab 各自 RWD 對稱性
9. Sticky/fixed 元素遮擋
10. Modal/Sheet/Dialog mobile overflow
11. Recharts mobile overflow
12. Table mobile fallback
13. Hover-only 互動 touch 替代
14. 桌機 aside 在 mobile 的入口
15. PWA prompt 桌機等效

### B. 登入×綁定×訂閱×配額×好友 正交矩陣（輪 16–35）
矩陣：`{guest, email-only, line-only, email+line, line-friend}` × `{none, free, line_free, basic, pro}` × `{quota-remain, exhausted, expired}` × `{trading-window, off-hours}`

16. `tier === 'none'` 引導路徑完整性
17. `tier === 'line_free'` 文案一致
18. `isLineFriend === false` 引導 UI
19. `lineProfile == null` + `supabaseUser != null` 綁定 CTA
20. `hasReachedDailyLimit` 升級 CTA 而非死路
21. `canUpload === false` 是否仍顯示上傳區
22. `canRefreshManually` gate 付費引導
23. `mode === 'line_only'` 加好友 CTA
24. `mode === 'demo'` 登入入口每個 panel 都有
25. **手動續訂模型**：補償會員 / 舊會員 / `expires_at>now` 是否被誤擋（HoldingsQuotaMeter 同類）
26. `< 7 天到期` 提醒 banner 每入口
27. 退款後 UI 提示
28. `is_tester` 旗標遺漏入口
29. Email-only → LINE 推播設定引導
30. LINE-only → Email 通知設定引導
31. Cross-product 折扣資格提示
32. PendingRemittanceGuard 每付款入口
33. LINE 綁但非好友的 push 失敗提示
34. Mentor vs Advisor（藍/主色/權限）混淆
35. Account 三 identity 整合一致性

### C. Gate 三軌分離（前端 + Edge）（輪 36–45）
憲法：上傳 = auth gate；解析 = auth gate；分析 = quota gate。

36. 前端 `hasQuota` 全用法 — 誤擋上傳/解析
37. 前端 `hasReachedDailyLimit` 全用法 — 同上
38. **所有 edge function** `consumeCheckupQuota` 呼叫 — 是否誤用在 parse/upload/research/calendar/predict-events/knowledge
39. **所有 edge function** `requireCheckupAuth` 該用而沒用
40. `parseShot` / `parseUpload` / `enqueueFiles` quota 前置攔截
41. AI fallback chain（gateway → direct gemini → anthropic）每入口走 `preferFast`（除 brain-update）
42. **39 個 edge function 的 CORS** — 是否每個 response（含 error）都有 `corsHeaders`；是否有殘留 inline `const corsHeaders` 與 `_shared/cors.ts` 並用造成漂移
43. **18 個 checkup edge** `EDGE_SCHEMAS` 覆蓋率 + 與實際 body 一致性
44. `check_checkup_quota` RPC EXCEPTION 兜底契約 — 每呼叫端正確處理 NULL（含 last_used_at）
45. 配額顯示 `period` 文案（week/month/lifetime）與後端一致

### D. RLS / GRANT / 資料安全（輪 46–60）
46. **所有** `CREATE TABLE public.*` migration → 對應 GRANT（authenticated / service_role / anon 視政策）
47. RLS policy 禁用 profile.role / users.role 欄位（必走 `user_roles` + `has_role`）
48. `has_role` security definer 一致性
49. 所有 view 用 `security_invoker = true`
50. **`perf_metrics` 401 RLS 阻擋**（log 實證）— anon insert policy 缺失，全表掃 anon 寫入路徑
51. anon 可寫表 rate limit / size limit
52. 敏感欄位 masking view 覆蓋
53. Service-role-only RPC 誤開 authenticated
54. **每個 edge function** `verify_jwt` 設定 vs in-code JWT 驗證一致性（含 webhook 應該 false 但驗簽章）
55. LINE webhook 簽章驗證（webhook / push 共用）
56. Webhook idempotency（重複事件）
57. ACpay / ECPay encryption / signature 驗證（已停 recurring，仍要驗單筆）
58. 任何 `execute_sql` / raw SQL string concat 殘留
59. localStorage / sessionStorage 敏感 token
60. `line_{ID}@line.local` 在所有 email 流程被正確排除（含 Resend / 通知 / 推播）

### E. Edge Functions 專屬（輪 61–75）— 39 支全納入
61. 每個 edge 都用 `_shared/supabaseClients.ts`（不再 inline `createClient`，pin 漂移）
62. 每個 edge 都用 `_shared/cors.ts`（不再 inline `corsHeaders`）
63. 每個 edge 都用 `_shared/edgeLogger.ts` `withLogging`（requestId / duration / x-correlation-id 回拋）
64. 所有 POST edge body 用 Zod / `inputValidator.ts` 驗證（400 + 明確訊息）
65. 所有 edge response 包 `corsHeaders`（含 error path、含 4xx/5xx）
66. 所有 edge 呼叫第三方有 timeout / retry / circuit breaker（TWSE / MOPS / Gemini / Anthropic / LINE API / Resend / ECPay）
67. **AI fallback chain 完整性**：每個呼 AI 的 edge 都有 gateway → direct → anthropic 三段
68. AI prompt 注入防禦（user 內容轉義 / system prompt 隔離）
69. Edge 對 DB 寫入用 `serviceClient()` vs `userClient(req)` 選擇正確（privilege bug）
70. 排程 edge（cron）冪等性 + 失敗重跑安全
71. `stock-name-lookup` / `checkup-twse` / `checkup-institutional` 快取策略（避免 rate limit）
72. `checkup-sparkline` / `checkup-calendar` 大量 stocks 的 batching / chunking
73. `line-login-callback` state / nonce CSRF 防禦
74. `line-webhook` x-line-signature 驗證 + reply token TTL
75. `create-acpay-order` / `ecpay-*` IP 白名單 / callback URL 驗證 + amount tamper 防禦

### F. 顏色 / 設計憲法（輪 76–82）
76. Taiwan 紅綠（紅漲綠跌）全站損益
77. `bg-mentor` vs `bg-primary` 混用
78. 硬編碼 hex / rgb（必須 token）
79. `C.textSec` 用在主要內容（這次 bug 同類）
80. `--jh-*` 江湖色票散落
81. Holdings PnL monochrome orange 憲法
82. Kore-eda 風格（無 shadow/gradient/max 22px/500w）違規

### G. i18n / 文案 / 數字（輪 83–89）
83. FreeCheckup i18n 回歸（mem 清單）
84. 「自動扣款 / 自動續訂」殘留（manual renewal 後應移除）
85. ACpay 入口殘留
86. 民國 vs 西元年混用 + `YYYY/MM/DD` 一致
87. 數字千分位 / % / ± 符號一致
88. 空狀態 + Loading + Error 文案一致
89. 「健檢/健診/健康檢查」用詞統一

### H. 排程 / 時間視窗（輪 90–95）
90. Trading hours gate（Mon-Fri 08:00-20:00 UTC+8）所有寫入點 + edge
91. Publishing window 限制覆蓋
92. Mentor cron 所有相關表更新
93. Subscription expire cron 處理所有 plan 類型
94. Renewal reminder 排程（manual renewal）
95. Timezone 混用（client / UTC / UTC+8）+ `formatTaipeiDate` 顯示點覆蓋

### I. 性能 / 錯誤恢復 / 觀測（輪 96–100）
96. `LazyOnVisible` / lazy import / `RouteChunkBoundary` / `staleChunkRecovery` 覆蓋每個 lazy route
97. React Query cache invalidation（補單 / 退款 / 綁定後不刷新）
98. Realtime subscription cleanup + reset 邏輯
99. `version.json` fetch 失敗的 offline fallback（log 實證一直失敗）
100. Edge function 對應的前端錯誤處理（401/403/429/500/timeout）+ `useEffect` 依賴 + race condition + ErrorBoundary 覆蓋

---

## P0–P5 嚴重度定義

| 等級 | 定義 | 範例 |
|---|---|---|
| **P0** | 安全洩漏 / 資金損失 / 全站 down / 隱私 | RLS 缺失 anon 可讀私資料、payment amount tamper、admin RPC 開給 authenticated、JWT 未驗 |
| **P1** | 付費用戶核心功能壞 / 訂閱誤判 / 配額誤扣 / 已綁用戶被當訪客 | 補償會員被誤擋上傳、quota 重複扣點、LINE 推播打錯 channel |
| **P2** | 引導路徑斷裂 / CTA 缺失 / 重要狀態無提示 | HoldingsQuotaMeter LINE CTA、桌機看不到 banner、到期前無提醒 |
| **P3** | UI 破版 / 對比不足 / RWD overflow / 文案不一致 | 反白字看不清、iPhone overflow、自動續訂殘留文案 |
| **P4** | 觀測性 / 重試 / 快取 / 性能退化 | 沒有 requestId log、無 timeout、cache 不 invalidate |
| **P5** | Code smell / 重複 boilerplate / 未用 `_shared/*` / lint 違規 | inline `corsHeaders`、inline `createClient`、hex 散落 |

---

## 執行方式

並行派 8 個 `acp_subagent` 唯讀調查員（每組覆蓋 12–15 輪）：

- Agent 1: A 組 RWD（輪 1–15）
- Agent 2: B 組正交矩陣（輪 16–35，capable model）
- Agent 3: C 組 Gate 三軌（輪 36–45，capable）
- Agent 4: D 組 RLS/GRANT/安全（輪 46–60，capable）
- Agent 5: E 組 Edge Functions 39 支（輪 61–75，capable）
- Agent 6: F 組設計憲法（輪 76–82）
- Agent 7: G+H 組 i18n+排程（輪 83–95）
- Agent 8: I 組性能/觀測（輪 96–100）

每 agent 回傳結構化 JSON：
```json
{
  "rule_id": "B-25",
  "rule": "補償會員被誤擋上傳",
  "files_scanned": 47,
  "violations": [{
    "file": "src/checkup/components/freecheckup/HoldingsQuotaMeter.tsx",
    "line": 88,
    "severity": "P1",
    "repro": "email-only + basic + auto_renew=false + expires_at>now",
    "root_cause": "tier check 只看 'none'/'free' 不看 expires_at",
    "fix": "改用 expires_at>now() 判定 active"
  }]
}
```

## 交付物

1. **`.lovable/audit-2026-06-deep-scan.md`** — 100 輪總表 + P0–P5 分類索引
2. **P0 / P1 立即修復清單** — 檔案:行號 + 根因 + 重現步驟 + 建議 patch
3. **P2 / P3 修復批次計畫** — 每批 ≤ 5 檔案，可獨立 review
4. **P4 / P5 重構待辦** — 進 backlog，不阻塞 P0–P3
5. **新增憲法測試**（防回歸）— 對 P0/P1 寫 vitest 鎖死

---

## 範圍最終確認

✅ Edge Functions 全 39 支納入（E 組 + C 組 + D 組多角度交叉）
✅ 嚴重度 P0–P5 已定義
✅ 100 輪窮舉、每輪一條不變式、不准漏

按 Approve 後我直接派 8 個 agent 並行掃，回報順序：
**P0 → P1 → 完整報告 → 修復批次計畫**。
P0 找到立刻停手回報，不等其他 agent。